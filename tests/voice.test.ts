import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Socket } from 'socket.io-client';
import { VoiceChat, type MicStatus } from '../src/audio/VoiceChat.ts';
import { DEFAULT_AVATAR, type Player, type RoomState, type VoiceSignal } from '../shared/protocol.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
class Track {
  kind = 'audio'; enabled = true; readyState = 'live'; onended: (() => void) | null = null;
  stop() { this.readyState = 'ended'; }
}
class Stream {
  constructor(public track = new Track()) {}
  getTracks() { return [this.track]; }
  getAudioTracks() { return [this.track]; }
}
class AudioParamBoundary {
  value=0;
  cancelScheduledValues(){}
  setValueAtTime(value:number){this.value=value;}
  setTargetAtTime(value:number){this.value=value;}
}
class AudioNodeBoundary {
  connections=new Set<AudioNodeBoundary>();disconnected=false;fftSize=1024;type='';
  gain=new AudioParamBoundary();frequency=new AudioParamBoundary();Q=new AudioParamBoundary();
  threshold=new AudioParamBoundary();knee=new AudioParamBoundary();ratio=new AudioParamBoundary();attack=new AudioParamBoundary();release=new AudioParamBoundary();
  positionX=new AudioParamBoundary();positionY=new AudioParamBoundary();positionZ=new AudioParamBoundary();
  panningModel='';distanceModel='';rolloffFactor=1;coneInnerAngle=360;coneOuterAngle=360;
  stream=new Stream();
  connect(target:AudioNodeBoundary){this.connections.add(target);return target;}
  disconnect(){this.disconnected=true;this.connections.clear();}
  getByteTimeDomainData(data:Uint8Array){data.fill(128);}
  getFloatTimeDomainData(data:Float32Array){data.fill(0);}
}
class Sender {
  track: Track | null = null;
  fail = false;
  wait?: Promise<void>;
  async replaceTrack(track: Track | null) {
    if (track && this.fail) throw new Error('replaceTrack failed');
    if (track && this.wait) await this.wait;
    this.track = track;
  }
}
class PeerConnection {
  static instances: PeerConnection[] = [];
  signalingState = 'stable'; connectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  transceivers: { sender: Sender; receiver: { track: Track }; direction: string }[] = [];
  candidates: RTCIceCandidateInit[] = [];
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() { PeerConnection.instances.push(this); }
  addTransceiver(_kind: string, options: { direction: string }) {
    const transceiver = { sender: new Sender(), receiver: { track: new Track() }, direction: options.direction };
    this.transceivers.push(transceiver); return transceiver;
  }
  getTransceivers() { return this.transceivers; }
  async createOffer() { return { type: 'offer' as const, sdp: 'offer' }; }
  async createAnswer() { return { type: 'answer' as const, sdp: 'answer' }; }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
    if (description.type === 'offer' && !this.transceivers.length) this.addTransceiver('audio', { direction: 'recvonly' });
  }
  async addIceCandidate(candidate: RTCIceCandidateInit) { this.candidates.push(candidate); }
  close() { this.signalingState = 'closed'; this.connectionState = 'closed'; }
}
class SocketBoundary {
  connected = true;
  handlers = new Map<string, Set<(value: any) => void>>();
  sent: { event: string; value: any }[] = [];
  micAck?: Promise<boolean>;
  on(event: string, handler: (value: any) => void) { if (!this.handlers.has(event)) this.handlers.set(event, new Set()); this.handlers.get(event)!.add(handler); }
  off(event: string, handler: (value: any) => void) { this.handlers.get(event)?.delete(handler); }
  receive(event: string, value?: unknown) { for (const handler of this.handlers.get(event) ?? []) handler(value); }
  timeout() { return this; }
  emit(event: string, value: unknown, ack?: (error: Error | null, result: { ok: boolean }) => void) {
    this.sent.push({ event, value });
    if (ack) void (this.micAck ?? Promise.resolve(true)).then(ok => ack(null, { ok }));
  }
}
function room(...players: (string | Partial<Player> & { id: string })[]): RoomState {
  return { roomId: 'voice-test', players: Object.fromEntries(players.map(value => {
    const overrides = typeof value === 'string' ? { id: value } : value;
    return [overrides.id, { name: overrides.id, avatar: DEFAULT_AVATAR, position: [0, 0, 0], yaw: 0, mode: 'walk', assetId: null, mic: false, emote: null, emoteUntil: 0, pose: null, poseAt: 0, chat: null, ...overrides }];
  })), occupancy: {}, notes: {}, conductor: { ownerId: null, bpm: 96, playing: false, startAt: 0, beats: 4, gesture: 'beat', gestureAt: 0 }, serverTime: 0 };
}
function harness(t: TestContext) {
  PeerConnection.instances = [];
  const streams: Stream[] = [], statuses: MicStatus[] = [], errors: string[] = [], speaking:Set<string>[]=[];
  const audios: { autoplay: boolean; volume: number; muted: boolean; dataset: Record<string, string>; style: Record<string, string>; srcObject: unknown; removed: boolean; setAttribute: () => void; remove: () => void; play: () => Promise<void> }[] = [];
  const nodes:AudioNodeBoundary[]=[];const node=()=>{const value=new AudioNodeBoundary();nodes.push(value);return value;};
  const context = {currentTime:0,destination:node(),listener:Object.fromEntries(['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'].map(key=>[key,new AudioParamBoundary()])),createGain:node,createDynamicsCompressor:node,createPanner:node,createBiquadFilter:node,createMediaStreamDestination:node,createMediaStreamSource:node,createAnalyser:node,resume:async()=>{}};
  const capture = { calls: 0, constraints: undefined as MediaStreamConstraints | undefined, next: undefined as Promise<Stream> | undefined, async getUserMedia(constraints:MediaStreamConstraints) { this.constraints=constraints;this.calls++; if (this.next) return this.next; const stream = new Stream(); streams.push(stream); return stream; } };
  const globals: Record<string, unknown> = {
    RTCPeerConnection: PeerConnection,
    navigator: { mediaDevices: { getUserMedia: (constraints:MediaStreamConstraints) => capture.getUserMedia(constraints) } },
    document: { body: { append() {} }, createElement() {
      const audio = { autoplay: false, volume: 1, muted: false, dataset: {}, style: {}, srcObject: null as unknown, removed: false, setAttribute() {}, remove() { this.removed = true; }, async play() {} };
      audios.push(audio); return audio;
    } },
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
  }
  const socket = new SocketBoundary();
  const chat = new VoiceChat(socket as unknown as Socket, context as unknown as AudioContext, value => statuses.push(value), value => errors.push(value), ids => speaking.push(ids));
  t.after(() => chat.dispose());
  const peerGain=(id:string)=>(chat as unknown as {peers:Map<string,{gain:AudioNodeBoundary}>}).peers.get(id)?.gain.gain.value;
  return { chat, socket, statuses, errors, streams, capture, audios, nodes, context, peerGain, speaking, peers: PeerConnection.instances };
}
const offer = (from: string): VoiceSignal => ({ from, to: 'z', description: { type: 'offer', sdp: 'offer' } });

test('unchanged speaking state does not repeatedly notify the interface',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const h=harness(t);h.chat.setState(room('a'),'a');
  t.mock.timers.tick(1500);assert.equal(h.speaking.length,0);
  await h.chat.enable();
  for(const node of h.nodes)node.getByteTimeDomainData=data=>{data.fill(160);};
  t.mock.timers.tick(1500);assert.equal(h.speaking.length,1);assert.deepEqual([...h.speaking[0]],['a']);
  h.chat.disable();t.mock.timers.tick(1500);assert.equal(h.speaking.length,2);assert.equal(h.speaking[1].size,0);
});

test('disposing while a peer speaks immediately clears the interface exactly once',t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const h=harness(t);h.chat.setState(room('a',{id:'z',mic:true}),'a');
  h.peers[0].ontrack!({streams:[new Stream()]} as unknown as RTCTrackEvent);
  for(const node of h.nodes)node.getByteTimeDomainData=data=>{data.fill(160);};
  t.mock.timers.tick(150);assert.deepEqual(h.speaking.map(ids=>[...ids]),[['z']]);
  h.chat.dispose();
  assert.deepEqual(h.speaking.map(ids=>[...ids]),[['z'],[]]);
  h.chat.dispose();t.mock.timers.tick(1500);
  assert.equal(h.speaking.length,2);
});

test('disposing a silent session does not notify an unchanged speaking state',t=>{
  const h=harness(t);h.chat.dispose();h.chat.dispose();
  assert.equal(h.speaking.length,0);
});

test('capture requests echo cancellation and denoising without automatic noise gain',async t=>{
  const h=harness(t);h.chat.setState(room('a'),'a');await h.chat.enable();
  const constraints=h.capture.constraints?.audio as MediaTrackConstraints;
  assert.equal(constraints.echoCancellation,true);
  assert.equal(constraints.noiseSuppression,true);
  assert.equal(constraints.autoGainControl,false);
});

test('an offer received before the membership snapshot is answered once the sender joins', async t => {
  const h = harness(t); h.chat.setState(room('z'), 'z');
  h.socket.receive('signal', offer('a'));
  h.chat.setState(room('a', 'z'), 'z'); await settle();
  assert.equal(h.socket.sent.filter(item => item.event === 'signal' && item.value.description?.type === 'answer').length, 1);
  assert.equal(h.capture.calls, 0, 'listening must not request microphone permission');
  assert.equal(h.peers[0].transceivers[0].direction, 'sendrecv');
});

test('a state received before the join acknowledgement never creates a peer for oneself', async t => {
  const h = harness(t); h.chat.setState(room('z'), '');
  h.chat.setState(room('z'), 'z'); await settle();
  assert.equal(h.peers.length, 0);
});

test('repeated room snapshots preserve the negotiated peer without repeated offers', async t => {
  const h = harness(t);
  for (let index = 0; index < 100; index++) h.chat.setState(room('a', 'z'), 'a');
  await settle();
  assert.equal(h.peers.length, 1);
  assert.equal(h.socket.sent.filter(item => item.value.description?.type === 'offer').length, 1);
});

test('repeated enable calls share one request and disable releases every acquired track', async t => {
  const h = harness(t), capture = deferred<Stream>(), stream = new Stream();
  h.chat.setState(room('a'), 'a'); h.capture.next = capture.promise;
  const first = h.chat.enable(), second = h.chat.enable(); capture.resolve(stream);
  await Promise.all([first, second]); await h.chat.enable();
  assert.equal(h.capture.calls, 1);
  h.chat.disable();
  assert.equal(stream.track.readyState, 'ended');
  assert.equal(h.statuses.at(-1), 'off');
});

for (const action of ['disable', 'piano', 'disconnect', 'dispose'] as const) test(`late microphone permission is discarded after ${action}`, async t => {
  const h = harness(t), capture = deferred<Stream>(), stream = new Stream();
  h.chat.setState(room('a'), 'a'); h.capture.next = capture.promise;
  const pending = h.chat.enable();
  if (action === 'piano') h.chat.setState(room({ id: 'a', mode: 'piano' }), 'a');
  else if (action === 'disconnect') { h.socket.connected = false; h.socket.receive('disconnect'); }
  else h.chat[action]();
  capture.resolve(stream); await pending;
  assert.equal(stream.track.readyState, 'ended');
  assert.equal(h.statuses.at(-1), 'off');
  assert.equal(h.socket.sent.some(item => item.event === 'mic' && item.value.enabled), false);
});

test('cancelling while the server mic acknowledgement is pending never publishes the track', async t => {
  const h = harness(t), ack = deferred<boolean>();
  h.chat.setState(room('a', 'z'), 'a'); await settle(); h.socket.micAck = ack.promise;
  const pending = h.chat.enable(); await settle(); h.chat.disable();
  assert.equal(h.streams[0].track.readyState, 'ended', 'cancel must release the microphone without waiting for the server acknowledgement');
  ack.resolve(true); await pending; await settle();
  assert.equal(h.streams[0].track.readyState, 'ended');
  assert.equal(h.peers[0].transceivers[0].sender.track, null);
  assert.equal(h.statuses.at(-1), 'off');
});

test('a track replacement failure stops capture and restores the server mic state', async t => {
  const h = harness(t); h.chat.setState(room('a', 'z'), 'a'); await settle();
  h.peers[0].transceivers[0].sender.fail = true;
  await h.chat.enable(); await settle();
  assert.equal(h.streams[0].track.readyState, 'ended');
  assert.equal(h.statuses.at(-1), 'off');
  assert.equal(h.socket.sent.filter(item => item.event === 'mic').at(-1)?.value.enabled, false);
  assert.equal(h.errors.length, 1);
});

test('disable wins when an earlier asynchronous track replacement finishes late', async t => {
  const h = harness(t), replacement = deferred<void>();
  h.chat.setState(room('a', 'z'), 'a'); await settle();
  const sender = h.peers[0].transceivers[0].sender; sender.wait = replacement.promise;
  const pending = h.chat.enable(); await settle(); h.chat.disable(); replacement.resolve(); await pending; await settle();
  assert.equal(h.streams[0].track.readyState, 'ended');
  assert.equal(sender.track, null);
  assert.equal(h.statuses.at(-1), 'off');
});

test('server microphone and piano state continue muting a peer after a local unmute', async t => {
  const h = harness(t); h.chat.setState(room('a', { id: 'z', mic: true }), 'a');
  assert.equal(h.peerGain('z'), 1);
  assert.equal(h.audios[0].muted,true,'the audio element must never bypass spatial attenuation');
  h.chat.mute('z', true); assert.equal(h.peerGain('z'), 0);
  h.chat.setState(room('a', { id: 'z', mic: false }), 'a');
  h.chat.mute('z', false); assert.equal(h.peerGain('z'), 0);
  h.chat.setState(room('a', { id: 'z', mic: true, mode: 'piano' }), 'a');
  h.chat.mute('z', false); assert.equal(h.peerGain('z'), 0);
  h.chat.setState(room('a', { id: 'z', mic: true }), 'a'); assert.equal(h.peerGain('z'), 1);
});

test('listener movement attenuates distant peers and view rotation updates spatial orientation',t=>{
  const h=harness(t);h.chat.setState(room('a',{id:'z',mic:true,position:[1,0,0]}),'a');
  h.chat.setListenerPose([0,1,0],[0,0,-1]);assert.equal(h.peerGain('z'),1);
  h.chat.setListenerPose([-6,1,0],[1,0,0]);assert.ok(h.peerGain('z')!<.1);
  assert.equal(h.context.listener.forwardX.value,1);
  h.chat.setListenerPose([-9,1,0],[1,0,0]);assert.equal(h.peerGain('z'),0);
});

test('microphone processing publishes a separate track and disconnects its graph on disable',async t=>{
  const h=harness(t);h.chat.setState(room('a','z'),'a');await settle();await h.chat.enable();
  const sent=h.peers[0].transceivers[0].sender.track;
  assert.ok(sent);assert.notEqual(sent,h.streams[0].track,'raw microphone must not bypass filtering');
  h.chat.disable();await settle();assert.equal(sent.readyState,'ended');assert.equal(h.streams[0].track.readyState,'ended');
  assert.equal(h.peers[0].transceivers[0].sender.track,null);
});

test('an insecure mobile address reports the HTTPS requirement without losing listening',async t=>{
  const h=harness(t);Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
  h.chat.setState(room('a',{id:'z',mic:true}),'a');await h.chat.enable();
  assert.match(h.errors[0],/HTTPS/);assert.equal(h.statuses.at(-1),'off');assert.equal(h.peerGain('z'),1);
});

test('disconnect closes old media immediately and reconnect builds fresh peer connections', async t => {
  const h = harness(t); h.chat.setState(room('a', 'z'), 'a'); await settle();
  await h.chat.enable();
  h.socket.connected = false; h.socket.receive('disconnect');
  assert.equal(h.peers[0].connectionState, 'closed');
  assert.equal(h.audios[0].removed, true);
  assert.equal(h.streams[0].track.readyState, 'ended');
  h.socket.connected = true; h.chat.setState(room('b', 'z'), 'b'); await settle();
  assert.equal(h.peers.length, 2);
  assert.equal(h.peers[1].localDescription?.type, 'offer');
});

test('changing the local session identity discards peers negotiated for the former identity', async t => {
  const h = harness(t); h.chat.setState(room('a', 'z'), 'a'); await settle();
  h.chat.setState(room('b', 'z'), 'b'); await settle();
  assert.equal(h.peers[0].connectionState, 'closed');
  assert.equal(h.peers.length, 2);
});
