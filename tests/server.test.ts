import test from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { startServer } from '../server/index.ts';
import type { Ack, PianoEvent, RoomLayout, RoomState } from '../shared/protocol.ts';

const layout: RoomLayout = { version: 1, bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 }, spawn: [0, 0, 0], floors: [], colliders: [], assets: [{ id: 'piano', label: 'Piano', type: 'piano', position: [1, .5, 0], approach: [.5, 0, 0], rotation: 0, radius: 2 }] };
async function connect(url: string) {
  const socket = io(url, { transports: ['websocket'], reconnection: false });
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return socket;
}
const emit = (socket: Socket, event: string, payload: unknown) => socket.timeout(1500).emitWithAck(event, payload) as Promise<Ack>;
function nextEvent<T>(socket: Socket, event: string, accept: (value: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timed out waiting for ${event}`)); }, 2000);
    const handler = (payload: T) => { if (accept(payload)) { socket.off(event, handler); clearTimeout(timer); resolve(payload); } };
    socket.on(event, handler);
  });
}

test('real sockets arbitrate piano race, isolate rooms, relay notes, and release on disconnect', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', layout });
  const sockets: Socket[] = [];
  try {
    const a = await connect(server.url), b = await connect(server.url), outsider = await connect(server.url);
    sockets.push(a, b, outsider);
    assert.equal((await emit(a, 'join', { roomId: '407', name: 'A' })).ok, true);
    assert.equal((await emit(b, 'join', { roomId: '407', name: 'B' })).ok, true);
    assert.equal((await emit(outsider, 'join', { roomId: 'other', name: 'C' })).ok, true);
    const claims = await Promise.all([emit(a, 'claim', { assetId: 'piano' }), emit(b, 'claim', { assetId: 'piano' })]);
    assert.equal(claims.filter(result => result.ok).length, 1);
    const owner = claims[0].ok ? a : b, listener = claims[0].ok ? b : a;
    let leakedNotes = 0, leakedSignals = 0;
    outsider.on('piano', () => leakedNotes++); outsider.on('signal', () => leakedSignals++);
    const note = nextEvent<PianoEvent>(listener, 'piano');
    assert.equal((await emit(owner, 'piano', { kind: 'on', midi: 60, velocity: .8 })).ok, true);
    assert.equal((await note).playerId, owner.id);
    assert.equal((await emit(owner, 'mic', { enabled: true })).ok, false);
    assert.equal((await emit(owner, 'signal', { to: outsider.id, description: { type: 'offer', sdp: 'secret' } })).ok, false);
    const signal = nextEvent<{ from: string }>(listener, 'signal');
    assert.equal((await emit(owner, 'signal', { to: listener.id, description: { type: 'offer', sdp: 'same-room' } })).ok, true);
    assert.equal((await signal).from, owner.id);
    const clear = nextEvent<PianoEvent>(listener, 'piano');
    const departed = owner.id!;
    const update = nextEvent<RoomState>(listener, 'state', state => !state.players[departed]);
    owner.disconnect();
    assert.equal((await clear).kind, 'clear');
    const state = await update;
    assert.equal(state.players[departed], undefined);
    assert.equal(state.occupancy.piano, undefined);
    assert.deepEqual(state.notes.piano, []);
    assert.equal(leakedNotes, 0); assert.equal(leakedSignals, 0);
    assert.equal((await emit(listener, 'claim', { assetId: 'piano' })).ok, true);
  } finally { sockets.forEach(socket => socket.disconnect()); await server.close(); }
});

test('HTTP health/config return public ICE settings without exposing arbitrary config', async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1', layout, iceServers: [{ urls: 'turn:relay.example:3478', username: 'guest', credential: 'temporary' }] });
  try {
    const health = await fetch(`${server.url}/api/health`).then(response => response.json());
    assert.equal(health.ok, true);
    const config = await fetch(`${server.url}/api/config`).then(response => response.json());
    assert.deepEqual(config, { iceServers: [{ urls: 'turn:relay.example:3478', username: 'guest', credential: 'temporary' }] });
  } finally { await server.close(); }
});
