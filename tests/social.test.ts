import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { RoomController } from '../server/room.ts';
import { startServer } from '../server/index.ts';
import type { Ack, RoomLayout, RoomState } from '../shared/protocol.ts';

const layout: RoomLayout = {
  version: 1, bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, spawn: [0, 0, 0], floors: [], colliders: [],
  assets: [
    { id: 'chair', type: 'chair', label: 'chair', position: [0, .5, 1], approach: [0, 0, .4], rotation: 0, radius: 2 },
    { id: 'piano', type: 'piano', label: 'piano', position: [1, .5, 0], approach: [.5, 0, 0], rotation: 0, radius: 2 },
    { id: 'conductor', type: 'conductor', label: 'conductor', position: [-1, 0, 0], approach: [-.5, 0, 0], rotation: 0, radius: 2 },
  ],
};
const style = { palette: 'mint', shape: 'cloud' };
function setup() {
  let now = 1000;
  const rooms = new RoomController(layout, { now: () => now });
  const join = (id: string, roomId = '407') => rooms.join(id, { roomId, name: id });
  const player = (id = 'a') => rooms.getState('407')!.players[id];
  return { rooms, join, player, advance: (ms: number) => { now += ms; } };
}

test('chat accepts line breaks from the composer while rejecting nonprinting control characters', () => {
  const { rooms, join, player, advance } = setup(); join('a');
  assert.equal(rooms.command('a', 'chat', { text: '大家好\n准备排练 🎵', style }).ok, true);
  assert.equal(player().chat?.text, '大家好\n准备排练 🎵');
  advance(1000);
  assert.equal(rooms.command('a', 'chat', { text: 'hidden\u0000text', style }).ok, false);
});

test('restarting the metronome after a cutoff immediately restores the beat gesture', () => {
  const { rooms, join, advance } = setup(); join('a');
  rooms.command('a', 'claim', { assetId: 'conductor' });
  rooms.command('a', 'conduct-gesture', { gesture: 'cutoff' });
  advance(100);
  rooms.command('a', 'tempo', { bpm: 96, playing: true });
  assert.equal(rooms.getState('407')?.conductor.gesture, 'beat');
});

test('held choir pose survives movement, sitting and a short emote, then explicitly clears', () => {
  const { rooms, join, player, advance } = setup(); join('a');
  assert.equal(rooms.command('a', 'pose', { pose: 'raise-left' }).ok, true);
  assert.equal(player().pose, 'raise-left'); assert.equal(player().poseAt, 1000);
  advance(500);
  assert.equal(rooms.command('a', 'pose', { pose: 'raise-left' }).ok, true);
  assert.equal(player().poseAt, 1000, 'an idempotent target must not restart the lift');
  assert.equal(rooms.command('a', 'move', { position: [0, 0, .3], yaw: 0 }).ok, true);
  assert.equal(rooms.command('a', 'claim', { assetId: 'chair' }).ok, true);
  assert.equal(rooms.command('a', 'emote', { emote: 'wave' }).ok, true);
  advance(3000); rooms.flushStates(() => {});
  assert.equal(player().emote, null); assert.equal(player().pose, 'raise-left');
  assert.equal(rooms.command('a', 'release', {}).ok, true);
  assert.equal(player().pose, 'raise-left');
  assert.equal(rooms.command('a', 'pose', { pose: null }).ok, true);
  assert.equal(player().pose, null); assert.equal(player().poseAt, 4500);
});

test('piano and conductor reserve the hands, clear held poses and reject emotes until released', () => {
  for (const assetId of ['piano', 'conductor']) {
    const { rooms, join, player } = setup(); join('a');
    assert.equal(rooms.command('a', 'pose', { pose: 'hand-right-chest' }).ok, true);
    rooms.command('a', 'emote', { emote: 'heart' });
    assert.equal(rooms.command('a', 'claim', { assetId }).ok, true);
    assert.equal(player().pose, null); assert.equal(player().emote, null);
    assert.equal(rooms.command('a', 'pose', { pose: 'raise-both' }).ok, false);
    assert.equal(rooms.command('a', 'emote', { emote: 'clap' }).ok, false);
    rooms.command('a', 'release', {});
    assert.equal(rooms.command('a', 'pose', { pose: 'raise-both' }).ok, true);
  }
});

test('pose validation rejects malformed targets without changing the current pose', () => {
  const { rooms, join, player } = setup(); join('a');
  assert.equal(rooms.command('a', 'pose', { pose: 'hand-left-chest' }).ok, true);
  for (const payload of [{}, { pose: true }, { pose: [] }, { pose: '__proto__' }, { pose: 'bad' }]) assert.equal(rooms.command('a', 'pose', payload).ok, false);
  assert.equal(player().pose, 'hand-left-chest');
});

test('conductor alone selects patterns and cues a shared clock, expression preserves playback and cutoff stops it', () => {
  const { rooms, join, advance } = setup(); join('a'); join('b');
  assert.equal(rooms.command('a', 'conduct-gesture', { gesture: 'cue' }).ok, false);
  rooms.command('a', 'claim', { assetId: 'conductor' });
  assert.equal(rooms.command('b', 'conduct-gesture', { gesture: 'cue' }).ok, false);
  for (const payload of [{ gesture: 'bad' }, { gesture: 'beat', beats: 5 }, { gesture: 'beat', beats: '3' }]) assert.equal(rooms.command('a', 'conduct-gesture', payload).ok, false);
  assert.equal(rooms.command('a', 'conduct-gesture', { gesture: 'beat', beats: 3 }).ok, true);
  assert.equal(rooms.getState('407')!.conductor.beats, 3);
  advance(500);
  assert.equal(rooms.command('a', 'conduct-gesture', { gesture: 'cue' }).ok, true);
  assert.equal(rooms.getState('407')!.conductor.playing, true);
  assert.equal(rooms.getState('407')!.conductor.startAt, 1500);
  advance(250);
  rooms.command('a', 'conduct-gesture', { gesture: 'crescendo' });
  assert.equal(rooms.getState('407')!.conductor.startAt, 1500);
  assert.equal(rooms.getState('407')!.conductor.gestureAt, 1750);
  rooms.command('a', 'conduct-gesture', { gesture: 'diminuendo' });
  assert.equal(rooms.getState('407')!.conductor.playing, true);
  advance(250);
  rooms.command('a', 'conduct-gesture', { gesture: 'beat', beats: 2 });
  assert.equal(rooms.getState('407')!.conductor.startAt, 2000);
  rooms.command('a', 'conduct-gesture', { gesture: 'cutoff' });
  assert.equal(rooms.getState('407')!.conductor.playing, false);
  assert.equal(rooms.getState('407')!.conductor.startAt, 0);
  rooms.command('a', 'release', {});
  assert.equal(rooms.getState('407')!.conductor.gesture, 'beat');
  assert.equal(rooms.getState('407')!.conductor.beats, 4);
  assert.equal(rooms.getState('407')!.conductor.gestureAt, 0);
});

test('chat uses server identity and time, counts Unicode codepoints, and retains plain text without interpreting markup', () => {
  const { rooms, join, player } = setup(); join('a'); join('b');
  const emoji = '🎶'.repeat(80);
  assert.equal(rooms.command('a', 'chat', { text: `  ${emoji}  `, style, playerId: 'b', at: 999999, until: 999999 }).ok, true);
  assert.deepEqual(player().chat, { text: emoji, style, at: 1000, until: 9000 });
  assert.equal(player('b').chat, null);
  assert.equal(rooms.command('a', 'chat', { text: '<b>大家好</b>', style: { palette: 'peach', shape: 'round', css: 'url(evil)' } }).ok, true);
  assert.deepEqual(player().chat?.style, { palette: 'peach', shape: 'round' });
  assert.equal(player().chat?.text, '<b>大家好</b>');
});

test('chat validation rejects blank, oversized, control text and styles outside presets', () => {
  for (const payload of [
    { text: '' }, { text: '  ' }, { text: '🎶'.repeat(81) }, { text: 2 }, { text: 'a\u0000b' },
    { text: 'hi', style: { palette: 'red', shape: 'round' } },
    { text: 'hi', style: { palette: 'mint', shape: 'url(evil)' } },
    { text: 'hi', style: [] },
  ]) {
    const { rooms, join, player } = setup(); join('a');
    assert.equal(rooms.command('a', 'chat', payload).ok, false);
    assert.equal(player().chat, null);
  }
});

test('chat rate has a small burst independent of controls and recovers without leaking expired bubbles to late joiners', () => {
  const { rooms, join, player, advance } = setup(); join('a');
  assert.equal(rooms.command('a', 'chat', { text: 'one', style }).ok, true);
  assert.equal(rooms.command('a', 'chat', { text: 'two', style }).ok, true);
  assert.equal(rooms.command('a', 'chat', { text: 'three', style }).ok, false);
  assert.equal(rooms.command('a', 'pose', { pose: 'raise-right' }).ok, true);
  advance(1000);
  assert.equal(rooms.command('a', 'chat', { text: 'three', style }).ok, true);
  assert.equal(join('late').state!.players.a.chat?.text, 'three');
  let broadcasts = 0; rooms.flushStates(() => broadcasts++);
  advance(8000);
  assert.equal(player().chat, null, 'snapshot must expire chat before periodic flush');
  assert.equal(join('later').state!.players.a.chat, null);
  rooms.flushStates(() => broadcasts++);
  assert.equal(broadcasts, 2);
  rooms.disconnect('a');
  assert.equal(join('a').state!.players.a.chat, null);
});

test('real sockets broadcast chat and held poses only inside their own room', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', layout });
  const sockets: Socket[] = [];
  const emit = (socket: Socket, event: string, payload: unknown) => socket.timeout(1500).emitWithAck(event, payload) as Promise<Ack>;
  try {
    for (let i = 0; i < 3; i++) {
      const socket = io(server.url, { transports: ['websocket'], reconnection: false }); sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      assert.equal((await emit(socket, 'join', { roomId: i === 2 ? 'other' : '407', name: `${i}` })).ok, true);
    }
    const [a, b, outsider] = sockets;
    const seen: RoomState[] = []; outsider.on('state', state => seen.push(state));
    const received = new Promise<RoomState>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('missing social room snapshot')), 2000);
      b.on('state', state => { if (state.players[a.id!]?.chat?.text === '一起唱🎶' && state.players[a.id!]?.pose === 'raise-both') { clearTimeout(timeout); resolve(state); } });
    });
    assert.equal((await emit(a, 'pose', { pose: 'raise-both' })).ok, true);
    assert.equal((await emit(a, 'chat', { text: '一起唱🎶', style })).ok, true);
    const update = await received;
    assert.equal(update.players[b.id!].chat, null);
    assert.equal(seen.some(state => state.players[a.id!]), false);
    const outsiderState = await emit(outsider, 'sync', {});
    assert.equal(outsiderState.state!.players[a.id!], undefined);
  } finally { sockets.forEach(socket => socket.disconnect()); await server.close(); }
});
