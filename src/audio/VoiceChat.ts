import type { Socket } from 'socket.io-client';
import type { Ack, RoomState, Vec3, VoiceSignal } from '../../shared/protocol';
import { DEFAULT_VOICE_VOLUME, SoftVoiceGate, voiceDistanceGain, voicePosition } from '../../shared/voice-spatial';

export type MicStatus = 'off' | 'requesting' | 'on';
type Peer = {
  id: string; pc: RTCPeerConnection; audio: HTMLAudioElement;
  sender: RTCRtpSender | null; queue: RTCIceCandidateInit[];
  analyser?: AnalyserNode; source?: MediaStreamAudioSourceNode; pending: Promise<void>;
  panner: PannerNode; gain: GainNode; level: number;
};

export class VoiceChat {
  private peers = new Map<string, Peer>();
  private waitingSignals: VoiceSignal[] = [];
  private capture: MediaStream | null = null;
  private stream: MediaStream | null = null;
  private state: RoomState | null = null;
  private self = '';
  private epoch = 0;
  private stopped = false;
  private pendingMic = false;
  private volume = DEFAULT_VOICE_VOLUME;
  private muted = new Set<string>();
  private speaking = new Set<string>();
  private iceServers: RTCIceServer[] = [];
  private iceRefreshTimer?: ReturnType<typeof setTimeout>;
  private meterTimer: ReturnType<typeof setInterval>;
  private analyser?: AnalyserNode;
  private source?: MediaStreamAudioSourceNode;
  private inputNodes: AudioNode[] = [];
  private gateGain?: GainNode;
  private gate = new SoftVoiceGate();
  private gateTimer?: ReturnType<typeof setInterval>;
  private master: GainNode;
  private mixCompressor: DynamicsCompressorNode;
  private listenerPosition: Vec3 = [0, 1, 0];
  private explicitListener = false;
  private onSignalBound: (message: VoiceSignal) => void;
  private onDisconnectBound: () => void;

  constructor(private socket: Socket, private context: AudioContext, private onStatus: (status: MicStatus) => void, private onError: (message: string) => void, private onSpeaking: (ids: Set<string>) => void) {
    this.master = context.createGain(); this.master.gain.value = this.volume;
    this.mixCompressor = context.createDynamicsCompressor();
    this.mixCompressor.threshold.value = -8; this.mixCompressor.knee.value = 10;
    this.mixCompressor.ratio.value = 10; this.mixCompressor.attack.value = .003; this.mixCompressor.release.value = .18;
    this.mixCompressor.connect(this.master); this.master.connect(context.destination);
    this.onSignalBound = message => this.receiveSignal(message);
    this.onDisconnectBound = () => {
      this.disable();
      this.clearPeers();
      this.waitingSignals = [];
      this.state = null;
      this.self = '';
      this.explicitListener = false;
    };
    socket.on('signal', this.onSignalBound);
    socket.on('disconnect', this.onDisconnectBound);
    this.meterTimer = setInterval(() => this.measure(), 150);
  }

  async configure() {
    if(this.stopped)return;
    clearTimeout(this.iceRefreshTimer);
    try {
      const response = await fetch('/api/config');
      if(!response.ok)throw new Error('Voice configuration unavailable');
      const data = await response.json();
      if(this.stopped)return;
      this.iceServers = Array.isArray(data.iceServers) ? data.iceServers : [];
      for(const peer of this.peers.values())if(peer.pc.signalingState!=='closed')peer.pc.setConfiguration({iceServers:this.iceServers});
    } catch { /* Retain working ICE settings on a transient network failure. */ }
    if(!this.stopped)this.iceRefreshTimer=setTimeout(()=>void this.configure(),15*60*1000);
  }

  setState(state: RoomState, self: string) {
    if (this.stopped) return;
    if (this.self && (this.self !== self || this.state?.roomId !== state.roomId)) {
      this.disable();
      this.clearPeers();
      this.waitingSignals = [];
      this.explicitListener = false;
    }
    this.state = state;
    this.self = self;
    if (!self || !state.players[self]) {
      if (this.stream || this.pendingMic) this.disable();
      this.clearPeers();
      return;
    }
    if (state.players[self].mode === 'piano' && (this.stream || this.pendingMic)) this.disable();
    for (const [id, peer] of this.peers) {
      if (!state.players[id] || id === self) this.removePeer(peer);
      else this.updatePeer(peer);
    }
    // A stable ordering assigns exactly one offerer, including listen-only peers.
    for (const id of Object.keys(state.players)) if (id !== self && !this.peers.has(id)) this.ensurePeer(id, self < id);
    if (!this.explicitListener) this.applyListenerPose(voicePosition(state.players[self]), [0, 0, -1], [0, 1, 0]);
    const waiting = this.waitingSignals;
    this.waitingSignals = [];
    for (const message of waiting) this.receiveSignal(message);
  }

  private receiveSignal(message: VoiceSignal) {
    if (this.stopped || !this.socket.connected || !message.from || message.from === this.self) return;
    // Signalling can arrive before the server's next membership broadcast or join acknowledgement.
    if (!this.self || !this.state?.players[this.self] || !this.state.players[message.from]) {
      if (this.waitingSignals.length < 256) this.waitingSignals.push(message);
      return;
    }
    const peer = this.ensurePeer(message.from, false);
    void this.enqueue(peer, () => this.signal(peer, message)).catch(() => {
      if (this.isCurrent(peer)) this.onError('语音连接暂时中断，可关闭麦克风后重试');
    });
  }

  private canSpeak() {
    return !this.stopped && this.socket.connected && !!this.state?.players[this.self] && this.state.players[this.self].mode !== 'piano';
  }

  private ackMic(enabled: boolean) {
    return new Promise<boolean>(resolve => this.socket.timeout(4000).emit('mic', { enabled }, (error: Error | null, result: Ack) => resolve(!error && !!result?.ok)));
  }

  async enable() {
    if (this.pendingMic || this.stream) return;
    if (!this.canSpeak()) { this.onError('演奏结束后，可以再次点击开启麦克风'); return; }
    const version = ++this.epoch;
    this.pendingMic = true;
    this.onStatus('requesting');
    let captured: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前地址无法开麦：手机开麦需要 HTTPS 连接，电脑也可使用 localhost。');
      captured = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 }, video: false });
      if (version !== this.epoch || !this.canSpeak()) {
        this.stopStream(captured);
        if (version === this.epoch) this.disable();
        return;
      }
      this.capture = captured;
      if (!await this.ackMic(true) || version !== this.epoch || !this.canSpeak()) {
        this.stopStream(captured);
        if (version === this.epoch) this.disable();
        return;
      }
      const rawTrack = captured.getAudioTracks()[0];
      if (!rawTrack || rawTrack.readyState === 'ended') throw new Error('没有可用的麦克风音轨，请检查设备后重试');
      rawTrack.onended = () => { this.disable(); this.onError('麦克风已断开，请检查设备后重新开启'); };
      await this.context.resume();
      if (version !== this.epoch || !this.canSpeak()) { this.stopStream(captured); return; }
      this.stream = this.processMicrophone(captured);
      const track = this.stream.getAudioTracks()[0];
      await Promise.all([...this.peers.values()].map(peer => this.enqueue(peer, async () => {
        if (version === this.epoch) await peer.sender?.replaceTrack(track);
      })));
      if (version !== this.epoch || !this.canSpeak()) {
        this.stopStream(captured);
        if (version === this.epoch) this.disable();
        return;
      }
      this.pendingMic = false;
      this.onStatus('on');
    } catch (error) {
      if (captured) this.stopStream(captured);
      if (version !== this.epoch) return;
      this.disable();
      const e = error as Error;
      this.onError(e.name === 'NotAllowedError' ? '没有获得麦克风权限。你仍然可以听琴和游玩。' : e.name === 'NotFoundError' ? '没有找到麦克风，请连接设备后重试。' : e.message || '麦克风暂时无法开启');
    }
  }

  private stopStream(stream: MediaStream) {
    for (const track of stream.getTracks()) { track.onended = null; track.enabled = false; track.stop(); }
  }

  private processMicrophone(stream: MediaStream): MediaStream {
    this.source = this.context.createMediaStreamSource(stream);
    const highpass = this.context.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = 100; highpass.Q.value = .707;
    this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 1024;
    this.gateGain = this.context.createGain(); this.gateGain.gain.value = .12;
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -16; compressor.knee.value = 12; compressor.ratio.value = 4;
    compressor.attack.value = .003; compressor.release.value = .2;
    const trim = this.context.createGain(); trim.gain.value = .75;
    const output = this.context.createMediaStreamDestination();
    this.source.connect(highpass); highpass.connect(this.analyser); this.analyser.connect(this.gateGain);
    this.gateGain.connect(compressor); compressor.connect(trim); trim.connect(output);
    this.inputNodes = [highpass, this.analyser, this.gateGain, compressor, trim, output];
    const samples = new Float32Array(this.analyser.fftSize);
    this.gate.reset();
    this.gateTimer = setInterval(() => {
      if (!this.analyser || !this.gateGain) return;
      this.analyser.getFloatTimeDomainData(samples);
      let sum = 0; for (const value of samples) sum += value * value;
      const target = this.gate.gain(Math.sqrt(sum / samples.length), this.context.currentTime);
      this.smooth(this.gateGain.gain, target, target > this.gateGain.gain.value ? .005 : .18);
    }, 20);
    return output.stream;
  }

  disable() {
    ++this.epoch;
    this.pendingMic = false;
    if (this.capture) this.stopStream(this.capture);
    this.capture = null;
    if (this.stream) this.stopStream(this.stream);
    this.stream = null;
    // Serialize detachment after any in-flight replacement; stopped tracks cannot transmit in the meantime.
    for (const peer of this.peers.values()) void this.enqueue(peer, async () => { await peer.sender?.replaceTrack(null); }).catch(() => {});
    this.source?.disconnect();
    this.source = undefined;
    this.analyser = undefined;
    for (const node of this.inputNodes) node.disconnect();
    this.inputNodes = []; this.gateGain = undefined; this.gate.reset();
    if (this.gateTimer) clearInterval(this.gateTimer); this.gateTimer = undefined;
    this.onStatus('off');
    if (this.socket.connected) void this.ackMic(false);
  }

  private isCurrent(peer: Peer) { return !this.stopped && this.socket.connected && this.peers.get(peer.id) === peer && peer.pc.signalingState !== 'closed'; }

  private enqueue(peer: Peer, operation: () => Promise<void>) {
    const result = peer.pending.then(async () => { if (this.isCurrent(peer)) await operation(); });
    peer.pending = result.catch(() => {});
    return result;
  }

  private isMuted(id: string) { return this.muted.has(id) || !this.state?.players[id]?.mic || this.state.players[id].mode === 'piano'; }

  private ensurePeer(id: string, initiate: boolean): Peer {
    const existing = this.peers.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers }), audio = document.createElement('audio');
    // The element keeps browser stream playback active but is never audible.
    // All sound takes the single spatial Web Audio path below.
    audio.autoplay = true; audio.volume = 0; audio.muted = true;
    audio.setAttribute('playsinline', ''); audio.dataset.peer = id; audio.style.display = 'none';
    document.body.append(audio);
    const panner = this.context.createPanner(), gain = this.context.createGain();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.rolloffFactor = 0;
    panner.coneInnerAngle = 360; panner.coneOuterAngle = 360; gain.gain.value = 0;
    panner.connect(gain); gain.connect(this.mixCompressor);
    const peer: Peer = { id, pc, audio, sender: null, queue: [], pending: Promise.resolve(), panner, gain, level: 0 };
    this.peers.set(id, peer);
    this.updatePeer(peer);
    pc.onicecandidate = event => { if (event.candidate && this.isCurrent(peer)) this.socket.emit('signal', { to: id, candidate: event.candidate.toJSON() }); };
    pc.ontrack = event => {
      if (!this.isCurrent(peer)) return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => { if (this.isCurrent(peer)) this.onError('点击底部「开启声音」以收听房间'); });
      peer.source?.disconnect();
      peer.analyser?.disconnect();
      peer.source = this.context.createMediaStreamSource(stream);
      peer.analyser = this.context.createAnalyser(); peer.analyser.fftSize = 1024;
      peer.source.connect(peer.analyser); peer.analyser.connect(peer.panner);
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && this.isCurrent(peer)) this.onError('有一位伙伴的语音未连通，跨网络可能需要语音中继配置'); };
    if (initiate) {
      peer.sender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      void this.enqueue(peer, async () => {
        await peer.sender!.replaceTrack(this.stream?.getAudioTracks()[0] ?? null);
        if (!this.isCurrent(peer)) return;
        await pc.setLocalDescription(await pc.createOffer());
        if (this.isCurrent(peer)) this.socket.emit('signal', { to: id, description: pc.localDescription });
      }).catch(() => { if (this.isCurrent(peer)) this.onError('语音连接暂时中断，请重新进入房间'); });
    }
    return peer;
  }

  private async signal(peer: Peer, message: VoiceSignal) {
    const pc = peer.pc;
    if (message.description) {
      await pc.setRemoteDescription(message.description);
      if (!this.isCurrent(peer)) return;
      for (const candidate of peer.queue) await pc.addIceCandidate(candidate);
      peer.queue = [];
      if (message.description.type === 'offer') {
        const transceiver = pc.getTransceivers().find(item => item.receiver.track.kind === 'audio') ?? pc.addTransceiver('audio', { direction: 'sendrecv' });
        transceiver.direction = 'sendrecv';
        peer.sender = transceiver.sender;
        await peer.sender.replaceTrack(this.stream?.getAudioTracks()[0] ?? null);
        if (!this.isCurrent(peer)) return;
        await pc.setLocalDescription(await pc.createAnswer());
        if (this.isCurrent(peer)) this.socket.emit('signal', { to: peer.id, description: pc.localDescription });
      }
    } else if (message.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(message.candidate);
      else peer.queue.push(message.candidate);
    }
  }

  private removePeer(peer: Peer) {
    this.peers.delete(peer.id);
    peer.pc.ontrack = null; peer.pc.onicecandidate = null; peer.pc.onconnectionstatechange = null;
    peer.pc.close(); peer.source?.disconnect(); peer.analyser?.disconnect(); peer.panner.disconnect(); peer.gain.disconnect();
    peer.audio.srcObject = null; peer.audio.remove();
  }

  private clearPeers() { for (const peer of this.peers.values()) this.removePeer(peer); }

  private measure() {
    const ids = new Set<string>();
    const active = (analyser: AnalyserNode) => {
      const data = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data);
      let sum = 0; for (const n of data) sum += (n - 128) ** 2;
      return Math.sqrt(sum / data.length) > 3;
    };
    if (this.analyser && active(this.analyser)) ids.add(this.self);
    for (const [id, peer] of this.peers) if (peer.analyser && peer.level > .01 && !this.isMuted(id) && active(peer.analyser)) ids.add(id);
    if(ids.size!==this.speaking.size||[...ids].some(id=>!this.speaking.has(id))){this.speaking=ids;this.onSpeaking(ids);}
  }

  private smooth(param: AudioParam, value: number, seconds = .06) { param.cancelScheduledValues(this.context.currentTime); param.setTargetAtTime(value, this.context.currentTime, seconds); }

  private updatePeer(peer: Peer) {
    const player = this.state?.players[peer.id]; if (!player) return;
    const position = voicePosition(player);
    if (peer.panner.positionX) {
      this.smooth(peer.panner.positionX, position[0]); this.smooth(peer.panner.positionY, position[1]); this.smooth(peer.panner.positionZ, position[2]);
    } else peer.panner.setPosition(...position);
    const muted = this.isMuted(peer.id);
    const level = muted ? 0 : voiceDistanceGain(Math.hypot(...position.map((v, i) => v - this.listenerPosition[i])));
    if (muted) {
      peer.level = 0; peer.gain.gain.cancelScheduledValues(this.context.currentTime); peer.gain.gain.setValueAtTime(0, this.context.currentTime);
    } else if (Math.abs(level - peer.level) > .00001) {
      peer.level = level;
      this.smooth(peer.gain.gain, level, .08);
    }
  }

  private applyListenerPose(position: Vec3, forward: Vec3, up: Vec3) {
    this.listenerPosition = [...position];
    const listener = this.context.listener;
    if (listener.positionX) {
      for (const [params, values] of [
        [[listener.positionX, listener.positionY, listener.positionZ], position],
        [[listener.forwardX, listener.forwardY, listener.forwardZ], forward],
        [[listener.upX, listener.upY, listener.upZ], up],
      ] as [AudioParam[], Vec3][]) for (let i = 0; i < 3; i++) this.smooth(params[i], values[i]);
    } else { listener.setPosition(...position); listener.setOrientation(...forward, ...up); }
    for (const peer of this.peers.values()) this.updatePeer(peer);
  }

  setListenerPose(position: Vec3, forward: Vec3, up: Vec3 = [0, 1, 0]) {
    if (this.stopped || ![...position, ...forward, ...up].every(Number.isFinite)) return;
    const length = Math.hypot(...forward), upLength = Math.hypot(...up); if (length < .001 || upLength < .001) return;
    this.explicitListener = true;
    this.applyListenerPose(position, forward.map(v => v / length) as Vec3, up.map(v => v / upLength) as Vec3);
  }

  setNoiseGateThreshold(db: number) { this.gate.setThreshold(db); }
  setVolume(value: number) { if (!Number.isFinite(value)) return; this.volume = Math.max(0, Math.min(1, value)); this.smooth(this.master.gain, this.volume); }
  mute(id: string, muted: boolean) {
    if (muted) this.muted.add(id); else this.muted.delete(id);
    const peer = this.peers.get(id); if (peer) this.updatePeer(peer);
  }
  async resume() { await this.context.resume(); await Promise.all([...this.peers.values()].map(peer => peer.audio.play().catch(() => {}))); }
  dispose() {
    if (this.stopped) return;
    this.stopped = true; this.disable(); clearInterval(this.meterTimer);clearTimeout(this.iceRefreshTimer);
    this.socket.off('signal', this.onSignalBound); this.socket.off('disconnect', this.onDisconnectBound);
    this.clearPeers(); this.waitingSignals = []; this.state = null;
    this.mixCompressor.disconnect(); this.master.disconnect();
    if(this.speaking.size){this.speaking=new Set();this.onSpeaking(this.speaking);}
  }
}
