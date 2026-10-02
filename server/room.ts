import { sanitizeAvatar } from '../shared/avatar.ts';
import { canStand, groundHeight, stepPosition } from '../shared/movement.ts';
import { CHAT_DURATION_MS, CHAT_MAX_CODEPOINTS, CHOIR_POSES, CONDUCTOR_GESTURES, DEFAULT_BUBBLE_STYLE, sanitizeBubbleStyle } from '../shared/social.ts';
import type { Ack, BeatPattern, ChoirPose, ConductorGesture, Emote, InteractionAsset, PianoEvent, Player, RoomLayout, RoomState, Vec3, VoiceSignal } from '../shared/protocol.ts';
import { getMinigameLayout, isGameChair, isMusicalChairsActive } from '../shared/minigames.ts';
import { MusicalChairsGame } from './minigames.ts';

export type RoomOptions = { now?: () => number; random?: () => number; onPiano?: (roomId: string, event: PianoEvent) => void };
type Piano = { held: Set<number>; sounding: Set<number>; sustain: boolean };
type Bucket = { at: number; tokens: number };
type Session = { roomId: string; moveAt: number; moveCredit: number; rates: Map<string, Bucket> };
type Room = { id: string; players: Map<string, Player>; occupancy: Map<string, string>; pianos: Map<string, Piano>; conductor: RoomState['conductor']; minigame: MusicalChairsGame; dirty: boolean };
const ok = (): Ack => ({ ok: true });
const fail = (error: string): Ack => ({ ok: false, error });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const vector = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number' && Number.isFinite(v));
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const identifier = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && /^[a-zA-Z0-9_-]+$/.test(value) && !reserved.has(value);

/** The only writer of room state. Socket handlers never accept client identities. */
export class RoomController {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<string, Session>();
  private readonly assets: Map<string, InteractionAsset>;
  private readonly now: () => number;
  private readonly onPiano?: RoomOptions['onPiano'];
  private readonly random: () => number;
  private readonly joinRates = new Map<string, Bucket>();

  constructor(private readonly layout: RoomLayout, options: RoomOptions = {}) {
    this.assets = new Map(layout.assets.map(asset => [asset.id, asset]));
    this.now = options.now ?? Date.now;
    this.onPiano = options.onPiano;
    this.random = options.random ?? Math.random;
  }

  join(id: string, payload: unknown): Ack {
    if (!identifier(id, 128)) return fail('连接标识无效');
    const bucket = this.joinRates.get(id) ?? { at: this.now(), tokens: 6 };
    this.joinRates.set(id, bucket);
    if (!this.take(bucket, 2, 6)) return fail('加入太频繁，请稍后再试');
    if (!object(payload) || !identifier(payload.roomId, 32)) return fail('房间号请使用 1–32 位字母、数字、横线或下划线');
    if (typeof payload.name !== 'string' || /[\u0000-\u001f\u007f]/.test(payload.name)) return fail('昵称无效');
    const name = payload.name.trim();
    if (!name || [...name].length > 24) return fail('昵称请使用 1–24 个字符');
    const current = this.rooms.get(payload.roomId);
    if (current && current.players.size >= 16 && !current.players.has(id)) return fail('这个房间已满（最多 16 人）');
    const position = this.chooseSpawn(current, id);
    if (!position) return fail('房间入口暂时拥挤，请稍后再试');
    this.leave(id);
    let room = this.rooms.get(payload.roomId);
    if (!room) {
      room = { id: payload.roomId, players: new Map(), occupancy: new Map(), pianos: new Map(), conductor: { ownerId: null, bpm: 90, playing: false, startAt: 0, beats: 4, gesture: 'beat', gestureAt: 0 }, minigame: undefined!, dirty: true };
      const created = room;
      room.minigame = new MusicalChairsGame({ now: this.now, random: this.random, players: room.players, occupancy: room.occupancy,
        conductorOccupied: () => !!created.conductor.ownerId || created.occupancy.has('conductor'),
        release: player => this.release(created, player), relocate: (player, position, yaw) => this.relocate(created, player, position, yaw),
        repairPositions: () => this.repairPositions(created), dirty: () => { created.dirty = true; } });
      for (const asset of this.assets.values()) if (asset.type === 'piano') room.pianos.set(asset.id, { held: new Set(), sounding: new Set(), sustain: false });
      this.rooms.set(room.id, room);
    }
    room.players.set(id, { id, name, avatar: sanitizeAvatar(payload.avatar), position, positionVersion: 0, yaw: 0, mode: 'walk', assetId: null, mic: false, emote: null, emoteUntil: 0, pose: null, poseAt: 0, chat: null });
    this.sessions.set(id, { roomId: room.id, moveAt: this.now(), moveCredit: .6, rates: new Map() });
    room.dirty = true;
    return { ok: true, id, state: this.getState(room.id) };
  }

  command(id: string, event: string, payload: unknown): Ack {
    const session = this.sessions.get(id), room = session && this.rooms.get(session.roomId), player = room?.players.get(id);
    if (!session || !room || !player) return fail('请先加入房间');
    if (!object(payload)) return fail('消息格式无效');
    room.minigame.tick(this.now());
    const group = event === 'move' ? 'move' : event === 'piano' ? 'piano' : event === 'chat' ? 'chat' : 'control';
    const piano = event === 'piano' && player.mode === 'piano' && player.assetId && room.occupancy.get(player.assetId) === id ? room.pianos.get(player.assetId) : undefined;
    // Only an actual transition towards silence bypasses the rate limit. Repeated
    // no-op cleanup messages are still limited, so this cannot amplify a flood.
    const stopsSound = piano && ((payload.kind === 'clear' && (piano.sounding.size > 0 || piano.held.size > 0 || piano.sustain)) || (payload.kind === 'off' && typeof payload.midi === 'number' && piano.held.has(payload.midi)) || (payload.kind === 'sustain' && payload.down === false && piano.sustain));
    if (!stopsSound && !this.rate(session, group)) return fail('操作太频繁，请稍后再试');
    switch (event) {
      case 'sync': return { ok: true, state: this.getState(room.id) };
      case 'move': {
        const result = this.move(room, session, player, payload);
        return result.ok ? result : { ...result, state: this.getState(room.id) };
      }
      case 'claim': return this.claim(room, player, payload);
      case 'minigame': return room.minigame.action(player, payload);
      case 'release':
        if (player.assetId && isGameChair(player.assetId) && isMusicalChairsActive(room.minigame.state)) return fail('本轮抢座后请等待下一轮；如需离开，请使用退赛');
        this.release(room, player); return ok();
      case 'avatar': player.avatar = sanitizeAvatar(payload.avatar); room.dirty = true; return ok();
      case 'mic':
        if (typeof payload.enabled !== 'boolean') return fail('麦克风状态无效');
        if (payload.enabled && player.mode === 'piano') return fail('演奏钢琴期间不能开启麦克风');
        if (player.mic !== payload.enabled) { player.mic = payload.enabled; room.dirty = true; }
        return ok();
      case 'emote':
        if (player.mode === 'piano' || player.mode === 'conduct') return fail('请先离开钢琴或指挥台再做动作');
        if (!['wave', 'clap', 'heart'].includes(payload.emote as string)) return fail('动作无效');
        player.emote = payload.emote as Emote; player.emoteUntil = this.now() + 2600; room.dirty = true; return ok();
      case 'pose':
        if (player.mode === 'piano' || player.mode === 'conduct') return fail('请先离开钢琴或指挥台再摆姿势');
        if (payload.pose !== null && !CHOIR_POSES.includes(payload.pose as ChoirPose)) return fail('姿势无效');
        if (player.pose !== payload.pose) { player.pose = payload.pose as ChoirPose | null; player.poseAt = this.now(); room.dirty = true; }
        return ok();
      case 'chat': return this.chat(room, player, payload);
      case 'piano': return this.piano(room, player, payload);
      case 'tempo': return this.tempo(room, player, payload);
      case 'conduct-gesture': return this.conductGesture(room, player, payload);
      default: return fail('未知操作');
    }
  }

  getRoomId(id: string): string | undefined { return this.sessions.get(id)?.roomId; }

  getState(roomId: string): RoomState | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;
    room.minigame.tick(this.now());
    this.expireSocial(room, this.now());
    return {
      roomId,
      players: Object.fromEntries([...room.players].map(([id, player]) => [id, structuredClone(player)])),
      occupancy: Object.fromEntries(room.occupancy),
      notes: Object.fromEntries([...room.pianos].map(([id, piano]) => [id, [...piano.sounding].sort((a, b) => a - b)])),
      pedals: Object.fromEntries([...room.pianos].map(([id, piano]) => [id, piano.sustain])),
      pressedNotes: Object.fromEntries([...room.pianos].map(([id, piano]) => [id, [...piano.held].sort((a, b) => a - b)])),
      conductor: { ...room.conductor },
      minigame: structuredClone(room.minigame.state),
      serverTime: this.now(),
    };
  }

  disconnect(id: string): void { this.leave(id); this.joinRates.delete(id); }

  flushStates(callback: (roomId: string, state: RoomState) => void): void {
    const now = this.now();
    for (const room of this.rooms.values()) {
      room.minigame.tick(now);
      this.expireSocial(room, now);
      if (room.dirty) { room.dirty = false; callback(room.id, this.getState(room.id)!); }
    }
  }

  relaySignal(id: string, payload: unknown): { to: string; signal: Omit<VoiceSignal, 'to'> } | null {
    const session = this.sessions.get(id);
    if (!session || !this.rate(session, 'signal') || !object(payload) || typeof payload.to !== 'string' || payload.to === id || this.getRoomId(payload.to) !== session.roomId) return null;
    const signal: Omit<VoiceSignal, 'to'> = { from: id };
    if (payload.description !== undefined) {
      const description = payload.description;
      if (!object(description) || !['offer', 'answer', 'pranswer', 'rollback'].includes(description.type as string) || (description.sdp !== undefined && (typeof description.sdp !== 'string' || description.sdp.length > 48000))) return null;
      signal.description = { type: description.type as RTCSdpType, ...(typeof description.sdp === 'string' ? { sdp: description.sdp } : {}) };
    }
    if (payload.candidate !== undefined) {
      const candidate = payload.candidate;
      if (!object(candidate) || (candidate.candidate !== undefined && (typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096)) || (candidate.sdpMid != null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 256)) || (candidate.sdpMLineIndex != null && (typeof candidate.sdpMLineIndex !== 'number' || !Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 128)) || (candidate.usernameFragment != null && (typeof candidate.usernameFragment !== 'string' || candidate.usernameFragment.length > 256))) return null;
      signal.candidate = { candidate: candidate.candidate as string | undefined, sdpMid: candidate.sdpMid as string | null | undefined, sdpMLineIndex: candidate.sdpMLineIndex as number | null | undefined, usernameFragment: candidate.usernameFragment as string | null | undefined };
    }
    return signal.description || signal.candidate ? { to: payload.to, signal } : null;
  }

  private move(room: Room, session: Session, player: Player, data: Record<string, unknown>): Ack {
    if (player.mode !== 'walk') return fail('请先离开当前互动');
    if (!vector(data.position) || typeof data.yaw !== 'number' || !Number.isFinite(data.yaw)) return fail('移动坐标无效');
    if (data.via !== undefined && (!Array.isArray(data.via) || data.via.length > 32 || !data.via.every(vector))) return fail('移动路径无效');
    const to = data.position, now = this.now();
    session.moveCredit = Math.min(1.5, session.moveCredit + Math.max(0, now - session.moveAt) / 1000 * 5);
    session.moveAt = now;
    // A render frame can turn or slide at a corner between network updates.
    // Validate those real samples in order instead of cutting across the turn.
    const points = [...(data.via as Vec3[] | undefined ?? []), to];
    let previous = player.position, distance = 0;
    for (const point of points) {
      distance += Math.hypot(point[0] - previous[0], point[2] - previous[2]);
      previous = point;
    }
    if (distance > session.moveCredit + .0001) return fail('移动速度过快');
    const effectiveLayout = getMinigameLayout(this.layout, room.minigame.state);
    let next = player.position;
    for (const point of points) {
      if (!canStand(effectiveLayout, point[0], point[2]) || Math.abs(point[1] - groundHeight(effectiveLayout, point[0], point[2])) > .15) return fail('不能移动到这里');
      next = stepPosition(effectiveLayout, next, point);
      if (Math.hypot(next[0] - point[0], next[2] - point[2]) > .035) return fail('前方有障碍');
    }
    session.moveCredit -= distance;
    room.minigame.moved(player, player.position, points, distance);
    const yaw = ((data.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (distance > .0001 || Math.abs(player.yaw - yaw) > .0001) { player.position = next; player.yaw = yaw; room.dirty = true; }
    return ok();
  }

  private claim(room: Room, player: Player, data: Record<string, unknown>): Ack {
    if (typeof data.assetId !== 'string' || reserved.has(data.assetId)) return fail('互动对象无效');
    if (isGameChair(data.assetId)) return room.minigame.claim(player, data);
    if (isMusicalChairsActive(room.minigame.state) && room.minigame.state.alive.includes(player.id)) return fail('比赛期间参赛者请保持走动，音乐停止后抢游戏椅');
    const asset = getMinigameLayout(this.layout, room.minigame.state).assets.find(asset => asset.id === data.assetId);
    if (!asset) return fail('互动对象不存在');
    if (player.mode !== 'walk' || player.assetId) return fail('请先离开当前互动');
    if (room.occupancy.has(asset.id)) return fail('这里已经有人了');
    if (Math.hypot(player.position[0] - asset.approach[0], player.position[2] - asset.approach[2]) > asset.radius || Math.abs(player.position[1] - asset.approach[1]) > 1.25) return fail('请先走近一点');
    room.occupancy.set(asset.id, player.id);
    player.assetId = asset.id;
    player.mode = asset.type === 'chair' ? 'sit' : asset.type === 'piano' ? 'piano' : 'conduct';
    this.relocate(room, player, asset.position, asset.rotation);
    if (player.mode === 'piano' || player.mode === 'conduct') {
      player.pose = null; player.poseAt = this.now(); player.emote = null; player.emoteUntil = 0;
    }
    if (asset.type === 'piano') player.mic = false;
    if (asset.type === 'conductor') room.conductor.ownerId = player.id;
    room.dirty = true;
    return ok();
  }

  private release(room: Room, player: Player): void {
    const asset = player.assetId && (this.assets.get(player.assetId) ?? room.minigame.state.chairs.find(chair => chair.id === player.assetId));
    if (asset) {
      if (asset.type === 'piano') this.clearPiano(room, player, asset.id);
      if (asset.type === 'conductor' && room.conductor.ownerId === player.id) {
        room.conductor = { ownerId: null, bpm: room.conductor.bpm, playing: false, startAt: 0, beats: 4, gesture: 'beat', gestureAt: 0 };
      }
      if (room.occupancy.get(asset.id) === player.id) room.occupancy.delete(asset.id);
      player.assetId = null; player.mode = 'walk'; room.dirty = true;
      this.relocate(room, player, asset.approach);
    }
  }

  private piano(room: Room, player: Player, data: Record<string, unknown>): Ack {
    if (player.mode !== 'piano' || !player.assetId || room.occupancy.get(player.assetId) !== player.id) return fail('请先坐到钢琴前');
    const piano = room.pianos.get(player.assetId)!;
    let event: PianoEvent;
    if (data.kind === 'on' || data.kind === 'off') {
      if (typeof data.midi !== 'number' || !Number.isInteger(data.midi) || data.midi < 21 || data.midi > 108) return fail('琴键无效');
      if (data.velocity !== undefined && (typeof data.velocity !== 'number' || !Number.isFinite(data.velocity) || data.velocity < 0 || data.velocity > 1)) return fail('力度无效');
      if (data.kind === 'on') { piano.held.add(data.midi); piano.sounding.add(data.midi); }
      else { piano.held.delete(data.midi); if (!piano.sustain) piano.sounding.delete(data.midi); }
      event = { kind: data.kind, midi: data.midi, ...(data.kind === 'on' ? { velocity: (data.velocity as number | undefined) ?? .75 } : {}) };
    } else if (data.kind === 'sustain') {
      if (typeof data.down !== 'boolean') return fail('踏板状态无效');
      piano.sustain = data.down;
      if (!data.down) piano.sounding = new Set(piano.held);
      event = { kind: 'sustain', down: data.down };
    } else if (data.kind === 'clear') { this.clearPiano(room, player, player.assetId); return ok(); }
    else return fail('钢琴消息无效');
    room.dirty = true;
    this.onPiano?.(room.id, { ...event, playerId: player.id, assetId: player.assetId, at: this.now() });
    return ok();
  }

  private clearPiano(room: Room, player: Player, assetId: string): void {
    const piano = room.pianos.get(assetId)!;
    piano.held.clear(); piano.sounding.clear(); piano.sustain = false; room.dirty = true;
    this.onPiano?.(room.id, { kind: 'clear', playerId: player.id, assetId, at: this.now() });
  }

  private tempo(room: Room, player: Player, data: Record<string, unknown>): Ack {
    if (player.mode !== 'conduct' || room.conductor.ownerId !== player.id) return fail('只有指挥可以设置节拍');
    if (typeof data.bpm !== 'number' || !Number.isFinite(data.bpm) || data.bpm < 40 || data.bpm > 200 || typeof data.playing !== 'boolean') return fail('节拍请设置为 40–200 BPM');
    const bpm = Math.round(data.bpm);
    if (data.playing && !room.conductor.playing) { room.conductor.gesture = 'beat'; room.conductor.gestureAt = this.now(); }
    if (data.playing && (!room.conductor.playing || room.conductor.bpm !== bpm)) room.conductor.startAt = this.now() + 180;
    if (!data.playing) room.conductor.startAt = 0;
    if (room.conductor.bpm !== bpm || room.conductor.playing !== data.playing) room.dirty = true;
    room.conductor.bpm = bpm; room.conductor.playing = data.playing;
    return ok();
  }

  private conductGesture(room: Room, player: Player, data: Record<string, unknown>): Ack {
    if (player.mode !== 'conduct' || room.conductor.ownerId !== player.id) return fail('只有指挥可以使用指挥手势');
    if (!CONDUCTOR_GESTURES.includes(data.gesture as ConductorGesture) || (data.beats !== undefined && ![2, 3, 4].includes(data.beats as number))) return fail('指挥手势或拍型无效');
    const conductor = room.conductor, now = this.now();
    const gesture = data.gesture as ConductorGesture;
    if (data.beats !== undefined && conductor.beats !== data.beats) {
      conductor.beats = data.beats as BeatPattern;
      if (conductor.playing) conductor.startAt = now;
    }
    if (gesture === 'cue') { conductor.playing = true; conductor.startAt = now; }
    if (gesture === 'cutoff') { conductor.playing = false; conductor.startAt = 0; }
    conductor.gesture = gesture; conductor.gestureAt = now; room.dirty = true;
    return ok();
  }

  private chat(room: Room, player: Player, data: Record<string, unknown>): Ack {
    if (typeof data.text !== 'string' || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(data.text)) return fail('消息需要使用文字或表情');
    const text = data.text.trim();
    if (!text || [...text].length > CHAT_MAX_CODEPOINTS) return fail(`消息请使用 1–${CHAT_MAX_CODEPOINTS} 个字符`);
    const style = data.style === undefined ? { ...DEFAULT_BUBBLE_STYLE } : sanitizeBubbleStyle(data.style);
    if (!style) return fail('消息泡样式无效');
    const now = this.now();
    player.chat = { text, style, at: now, until: now + CHAT_DURATION_MS }; room.dirty = true;
    return ok();
  }

  private expireSocial(room: Room, now: number): void {
    for (const player of room.players.values()) {
      if (player.emote && player.emoteUntil <= now) { player.emote = null; player.emoteUntil = 0; room.dirty = true; }
      if (player.chat && player.chat.until <= now) { player.chat = null; room.dirty = true; }
    }
  }

  private leave(id: string): void {
    const session = this.sessions.get(id), room = session && this.rooms.get(session.roomId), player = room?.players.get(id);
    if (room && player) { room.minigame.tick(this.now()); room.minigame.departed(id); this.release(room, player); room.players.delete(id); room.dirty = true; if (!room.players.size) this.rooms.delete(room.id); }
    this.sessions.delete(id);
  }

  private chooseSpawn(room: Room | undefined, joiningId: string): Vec3 | null {
    const effectiveLayout = getMinigameLayout(this.layout, room?.minigame.state);
    const others = [...(room?.players.values() ?? [])].filter(player => player.id !== joiningId);
    for (let ring = 0; ring <= 8; ring++) {
      const offsets: [number, number][] = [];
      for (let z = -ring; z <= ring; z++) for (let x = -ring; x <= ring; x++) if (Math.max(Math.abs(x), Math.abs(z)) === ring) offsets.push([x, z]);
      offsets.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      for (const [dx, dz] of offsets) {
        const x = this.layout.spawn[0] + dx * .65, z = this.layout.spawn[2] + dz * .65;
        if (!canStand(effectiveLayout, x, z) || others.some(player => Math.hypot(player.position[0] - x, player.position[2] - z) < .55)) continue;
        return [x, groundHeight(effectiveLayout, x, z), z];
      }
    }
    return null;
  }

  private relocate(room: Room, player: Player, position: Vec3, yaw = player.yaw): void {
    const effectiveLayout = getMinigameLayout(this.layout, room.minigame.state);
    if (player.mode === 'walk') {
      const available = (x: number, z: number) => canStand(effectiveLayout, x, z) && ![...room.players.values()].some(other => other.id !== player.id && Math.hypot(other.position[0] - x, other.position[2] - z) < .45);
      let target: Vec3 | null = available(position[0], position[2]) ? [position[0], groundHeight(effectiveLayout, position[0], position[2]), position[2]] : null;
      for (let ring = 1; !target && ring <= 100; ring++) {
        for (let side = 0; !target && side < 4; side++) for (let offset = -ring; !target && offset < ring; offset++) {
          const dx = side === 0 ? offset : side === 1 ? ring : side === 2 ? -offset : -ring;
          const dz = side === 0 ? -ring : side === 1 ? offset : side === 2 ? ring : -offset;
          const x = position[0] + dx * .2, z = position[2] + dz * .2;
          if (available(x, z)) target = [x, groundHeight(effectiveLayout, x, z), z];
        }
      }
      player.position = target ?? [...this.layout.spawn];
    } else player.position = [...position];
    player.yaw = yaw;
    player.positionVersion = (player.positionVersion ?? 0) + 1;
    const session = this.sessions.get(player.id);
    if (session) { session.moveAt = this.now(); session.moveCredit = .6; }
    room.minigame.state.teleportVersion++; room.dirty = true;
  }

  private repairPositions(room: Room): void {
    const effectiveLayout = getMinigameLayout(this.layout, room.minigame.state);
    for (const player of room.players.values()) if (player.mode === 'walk' && !canStand(effectiveLayout, player.position[0], player.position[2])) this.relocate(room, player, player.position);
  }

  private take(bucket: Bucket, rate: number, capacity: number): boolean {
    const now = this.now(); bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.at) / 1000 * rate); bucket.at = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens--; return true;
  }

  private rate(session: Session, group: string): boolean {
    const [rate, capacity] = group === 'move' ? [30, 12] : group === 'piano' ? [180, 180] : group === 'signal' ? [40, 80] : group === 'chat' ? [1, 2] : [20, 40];
    let bucket = session.rates.get(group);
    if (!bucket) { bucket = { at: this.now(), tokens: capacity }; session.rates.set(group, bucket); }
    return this.take(bucket, rate, capacity);
  }
}
