import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomController } from '../server/room.ts';
import { DEFAULT_AVATAR, type PianoEvent, type RoomLayout } from '../shared/protocol.ts';

const layout: RoomLayout = {
  version: 1, bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, spawn: [0, 0, 0],
  floors: [{ min: [-4, 2], max: [4, 3], height: .22 }],
  colliders: [{ min: [2, -1], max: [3, 1], id: 'wall' }],
  assets: [
    { id: 'chair', type: 'chair', label: 'Seat', position: [0, .5, 1], approach: [0, 0, .4], rotation: 1, radius: 1.5 },
    { id: 'piano', type: 'piano', label: 'Piano', position: [1, .5, 0], approach: [.5, 0, 0], rotation: 2, radius: 1.5 },
    { id: 'conductor', type: 'conductor', label: 'Conductor', position: [-1, 0, 0], approach: [-.5, 0, 0], rotation: 3, radius: 1.5 },
    { id: 'far', type: 'chair', label: 'Far seat', position: [7, .5, 7], approach: [7, 0, 6.5], rotation: 0, radius: 1.5 },
  ],
};
function setup() {
  let now = 1000;
  const events: { roomId: string; event: PianoEvent }[] = [];
  const rooms = new RoomController(layout, { now: () => now, onPiano: (roomId, event) => events.push({ roomId, event }) });
  const join = (id: string, roomId = '407') => rooms.join(id, { roomId, name: `Guest ${id}`, avatar: DEFAULT_AVATAR });
  return { rooms, events, join, advance: (ms = 1000) => { now += ms; } };
}

test('only one claimant acquires a seat, and one player cannot hold two interactions', () => {
  const { rooms, join } = setup();
  join('a'); join('b');
  assert.equal(rooms.command('a', 'claim', { assetId: 'chair' }).ok, true);
  assert.equal(rooms.command('b', 'claim', { assetId: 'chair' }).ok, false);
  assert.equal(rooms.command('a', 'claim', { assetId: 'piano' }).ok, false);
  const state = rooms.getState('407')!;
  assert.equal(state.occupancy.chair, 'a');
  assert.equal(state.players.a.mode, 'sit');
  assert.deepEqual(state.players.a.position, [0, .5, 1]);
  assert.equal(state.players.a.yaw, 1);
  assert.equal(rooms.command('a', 'move', { position: [0, 0, .1], yaw: 0 }).ok, false);
  assert.equal(rooms.command('a', 'release', {}).ok, true);
  assert.deepEqual(rooms.getState('407')!.players.a.position, [0, 0, .4]);
  assert.equal(rooms.command('b', 'claim', { assetId: 'chair' }).ok, true);
});

test('pianist is muted for the entire ownership, with no automatic unmute on release', () => {
  const { rooms, join } = setup(); join('a'); join('b');
  assert.equal(rooms.command('a', 'mic', { enabled: true }).ok, true);
  assert.equal(rooms.command('a', 'claim', { assetId: 'piano' }).ok, true);
  assert.equal(rooms.getState('407')!.players.a.mic, false);
  assert.equal(rooms.command('a', 'mic', { enabled: true }).ok, false);
  assert.equal(rooms.command('b', 'mic', { enabled: true }).ok, true);
  rooms.command('a', 'release', {});
  assert.equal(rooms.getState('407')!.players.a.mic, false);
  assert.equal(rooms.getState('407')!.players.b.mic, true);
});

test('piano sustains released notes, pedal-up releases them, and clear keeps ownership', () => {
  const { rooms, join, events } = setup(); join('a'); join('b');
  rooms.command('a', 'claim', { assetId: 'piano' });
  assert.equal(rooms.command('b', 'piano', { kind: 'on', midi: 60 }).ok, false);
  assert.equal(rooms.command('a', 'piano', { kind: 'on', midi: 60, velocity: .6, playerId: 'b' }).ok, true);
  rooms.command('a', 'piano', { kind: 'sustain', down: true });
  rooms.command('a', 'piano', { kind: 'off', midi: 60 });
  assert.deepEqual(rooms.getState('407')!.notes.piano, [60]);
  rooms.command('a', 'piano', { kind: 'on', midi: 64 });
  rooms.command('a', 'piano', { kind: 'sustain', down: false });
  assert.deepEqual(rooms.getState('407')!.notes.piano, [64]);
  rooms.command('a', 'piano', { kind: 'clear' });
  assert.deepEqual(rooms.getState('407')!.notes.piano, []);
  assert.equal(rooms.getState('407')!.occupancy.piano, 'a');
  assert.equal(events[0].event.playerId, 'a');
  assert.equal(events[0].event.assetId, 'piano');
  assert.equal(events[0].event.at, 1000);
});

test('latejoin snapshot separates sounding notes, held keys, and sustain pedal state', () => {
  const { rooms, join } = setup(); join('a');
  rooms.command('a', 'claim', { assetId: 'piano' });
  rooms.command('a', 'piano', { kind: 'on', midi: 60 });
  rooms.command('a', 'piano', { kind: 'sustain', down: true });
  rooms.command('a', 'piano', { kind: 'off', midi: 60 });
  rooms.command('a', 'piano', { kind: 'on', midi: 64 });
  const snapshot = join('latecomer').state!;
  assert.deepEqual(snapshot.notes.piano, [60, 64]);
  assert.deepEqual(snapshot.pressedNotes?.piano, [64]);
  assert.equal(snapshot.pedals?.piano, true);
  rooms.command('a', 'piano', { kind: 'sustain', down: false });
  const released = rooms.getState('407')!;
  assert.deepEqual(released.notes.piano, [64]);
  assert.deepEqual(released.pressedNotes?.piano, [64]);
  assert.equal(released.pedals?.piano, false);
});

test('third upright and digital piano allow concurrent owners and isolate sustain, clear and disconnect', () => {
  const third='piano-third-black',digital='piano-digital-black';
  const twoPianos:RoomLayout={...layout,colliders:[],floors:[],assets:[
    {id:third,type:'piano',label:'窗边立式钢琴',position:[1,.53,0],approach:[.5,0,0],rotation:Math.PI/2,radius:3},
    {id:digital,type:'piano',label:'电钢琴',position:[-1,.53,0],approach:[-.5,0,0],rotation:-Math.PI/2,radius:3},
  ]};
  const events:PianoEvent[]=[];
  const rooms=new RoomController(twoPianos,{onPiano:(_room,event)=>events.push(event)});
  for(const id of ['upright','digital','listener'])assert.equal(rooms.join(id,{roomId:'duet',name:id}).ok,true);
  const command=(id:string,event:string,data:Record<string,unknown>)=>assert.equal(rooms.command(id,event,data).ok,true);
  command('upright','claim',{assetId:third});command('digital','claim',{assetId:digital});
  assert.equal(rooms.command('listener','claim',{assetId:third}).ok,false);
  assert.equal(rooms.command('listener','claim',{assetId:digital}).ok,false);
  command('upright','piano',{kind:'on',midi:21});
  command('upright','piano',{kind:'sustain',down:true});
  command('upright','piano',{kind:'off',midi:21});
  command('digital','piano',{kind:'on',midi:108});
  const snapshot=rooms.join('late',{roomId:'duet',name:'late'}).state!;
  assert.deepEqual(snapshot.notes[third],[21]);assert.deepEqual(snapshot.notes[digital],[108]);
  assert.deepEqual(snapshot.pressedNotes![third],[]);assert.deepEqual(snapshot.pressedNotes![digital],[108]);
  assert.equal(snapshot.pedals![third],true);assert.equal(snapshot.pedals![digital],false);
  assert.equal(snapshot.occupancy[third],'upright');assert.equal(snapshot.occupancy[digital],'digital');
  command('upright','piano',{kind:'clear'});
  assert.deepEqual(rooms.getState('duet')!.notes[third],[]);
  assert.deepEqual(rooms.getState('duet')!.notes[digital],[108]);
  command('upright','piano',{kind:'on',midi:60});
  rooms.disconnect('digital');
  const after=rooms.getState('duet')!;
  assert.deepEqual(after.notes[third],[60]);assert.deepEqual(after.notes[digital],[]);
  assert.equal(after.occupancy[third],'upright');assert.equal(after.occupancy[digital],undefined);
  assert.equal(events.at(-1)!.kind,'clear');
  assert.equal(events.at(-1)!.playerId,'digital');
  assert.equal(events.at(-1)!.assetId,digital);
  assert.equal(events.find(event=>event.kind==='on'&&event.midi===21)?.assetId,third);
  assert.equal(events.find(event=>event.kind==='on'&&event.midi===108)?.assetId,digital);
});

test('disconnect sends immediate piano clear and releases every owned resource', () => {
  const { rooms, join, events } = setup(); join('a'); join('b');
  rooms.command('a', 'claim', { assetId: 'piano' });
  rooms.command('a', 'piano', { kind: 'on', midi: 21 });
  rooms.command('a', 'piano', { kind: 'sustain', down: true });
  rooms.disconnect('a');
  assert.equal(events.at(-1)!.event.kind, 'clear');
  assert.deepEqual(rooms.getState('407')!.notes.piano, []);
  assert.equal(rooms.getState('407')!.players.a, undefined);
  assert.equal(rooms.getState('407')!.occupancy.piano, undefined);
  assert.equal(rooms.command('b', 'claim', { assetId: 'piano' }).ok, true);
});

test('room isolation includes seats, signal targets, and repeat-join cleanup', () => {
  const { rooms, join, events } = setup(); join('a'); join('b', 'other'); join('c');
  rooms.command('a', 'claim', { assetId: 'piano' });
  rooms.command('b', 'claim', { assetId: 'piano' });
  assert.equal(rooms.getState('407')!.occupancy.piano, 'a');
  assert.equal(rooms.getState('other')!.occupancy.piano, 'b');
  assert.equal(rooms.relaySignal('a', { to: 'b', description: { type: 'offer', sdp: 'test' } }), null);
  const relayed = rooms.relaySignal('a', { to: 'c', from: 'b', description: { type: 'offer', sdp: 'test' } });
  assert.equal(relayed?.signal.from, 'a');
  assert.equal(join('a', 'other').ok, true);
  assert.equal(rooms.getState('407')!.occupancy.piano, undefined);
  assert.equal(rooms.getState('407')!.players.a, undefined);
  assert.equal(events.at(-1)!.roomId, '407');
});

test('conductor alone controls tempo and leaving stops the shared clock', () => {
  const { rooms, join, advance } = setup(); join('a'); join('b');
  assert.equal(rooms.command('a', 'tempo', { bpm: 100, playing: true }).ok, false);
  rooms.command('a', 'claim', { assetId: 'conductor' });
  assert.equal(rooms.command('b', 'tempo', { bpm: 100, playing: true }).ok, false);
  assert.equal(rooms.command('a', 'tempo', { bpm: 201, playing: true }).ok, false);
  assert.equal(rooms.command('a', 'tempo', { bpm: 100, playing: true }).ok, true);
  assert.equal(rooms.getState('407')!.conductor.playing, true);
  assert.ok(rooms.getState('407')!.conductor.startAt > 1000);
  const startAt = rooms.getState('407')!.conductor.startAt;
  advance();
  rooms.command('a', 'tempo', { bpm: 100, playing: true });
  assert.equal(rooms.getState('407')!.conductor.startAt, startAt);
  rooms.disconnect('a');
  assert.equal(rooms.getState('407')!.conductor.ownerId, null);
  assert.equal(rooms.getState('407')!.conductor.playing, false);
});

test('movement rejects teleportation, invalid height, walls, bounds, and non-finite values', () => {
  const { rooms, join, advance } = setup(); join('a');
  for (const position of [[NaN, 0, 0], [Infinity, 0, 0], [0, 7, 0], [7, 0, 7], [9, 0, 0]]) {
    advance(); assert.equal(rooms.command('a', 'move', { position, yaw: 0 }).ok, false);
  }
  advance();
  assert.equal(rooms.command('a', 'move', { position: [1, 0, 0], yaw: .5 }).ok, true);
  advance();
  assert.equal(rooms.command('a', 'move', { position: [2.4, 0, 0], yaw: .5 }).ok, false);
  const position = rooms.getState('407')!.players.a.position;
  assert.ok(Math.abs(position[0] - 1) < 1e-9);
  assert.equal(position[1], 0); assert.equal(position[2], 0);
});

test('distance, hostile object keys, malformed events, and piano ranges are rejected', () => {
  const { rooms, join } = setup(); join('a');
  for (const assetId of ['far', '__proto__', 'constructor', null]) assert.equal(rooms.command('a', 'claim', { assetId }).ok, false);
  for (const payload of [null, [], {}, { position: [0, 0], yaw: 0 }, { position: [0, 0, 0], yaw: NaN }]) assert.equal(rooms.command('a', 'move', payload).ok, false);
  assert.equal(rooms.command('a', 'mic', { enabled: 'yes' }).ok, false);
  assert.equal(rooms.command('a', 'emote', { emote: 'bad' }).ok, false);
  rooms.command('a', 'claim', { assetId: 'piano' });
  for (const payload of [{ kind: 'on', midi: 20 }, { kind: 'off', midi: 109 }, { kind: 'on', midi: 60.2 }, { kind: 'on', midi: 60, velocity: Infinity }, { kind: 'sustain', down: 1 }]) assert.equal(rooms.command('a', 'piano', payload).ok, false);
});

test('join validates room/name, caps rooms at 16, and initializes only real members', () => {
  const { rooms, join } = setup();
  for (const roomId of ['__proto__', 'constructor', '', 'a'.repeat(33), '../other']) assert.equal(join('invalid', roomId).ok, false);
  assert.equal(rooms.join('invalid', { roomId: '407', name: 'a'.repeat(25), avatar: {} }).ok, false);
  for (let i = 0; i < 16; i++) assert.equal(join(`player-${i}`).ok, true);
  assert.equal(join('overflow').ok, false);
  assert.equal(Object.keys(rooms.getState('407')!.players).length, 16);
  assert.equal(rooms.getState('407')!.players['player-0'].mic, false);
  assert.equal(join('overflow', 'spare').ok, true);
});

test('sixteen joining players receive separated walkable spawn positions inside the room', () => {
  const { rooms, join } = setup();
  for (let i = 0; i < 16; i++) assert.equal(join(`arrival-${i}`).ok, true);
  const players = Object.values(rooms.getState('407')!.players);
  assert.equal(players.length, 16);
  for (let i = 0; i < players.length; i++) {
    const [x, y, z] = players[i].position;
    assert.ok(x >= -7.82 && x <= 7.82 && z >= -7.82 && z <= 7.82);
    assert.ok(!(x > 1.82 && x < 3.18 && z > -1.18 && z < 1.18));
    assert.equal(y, z >= 2 && z <= 3 && x >= -4 && x <= 4 ? .22 : 0);
    for (let j = 0; j < i; j++) assert.ok(Math.hypot(x - players[j].position[0], z - players[j].position[2]) >= .55, 'new arrivals must not overlap existing players');
  }
});

test('input flooding is rate limited, emotes expire, and unchanged rooms do not rebroadcast', () => {
  const { rooms, join, advance } = setup(); join('a');
  let rejected = 0;
  for (let i = 0; i < 100; i++) if (!rooms.command('a', 'move', { position: [0, 0, 0], yaw: i }).ok) rejected++;
  assert.ok(rejected > 0);
  advance();
  assert.equal(rooms.command('a', 'emote', { emote: 'heart' }).ok, true);
  let broadcasts = 0;
  rooms.flushStates(() => broadcasts++);
  rooms.flushStates(() => broadcasts++);
  assert.equal(broadcasts, 1);
  advance(4000);
  rooms.flushStates(() => broadcasts++);
  assert.equal(broadcasts, 2);
  assert.equal(rooms.getState('407')!.players.a.emote, null);
});

test('note-off, pedal-up and clear remain available after the piano rate limit is exhausted', () => {
  for (const cleanup of [{ kind: 'clear' }, { kind: 'off', midi: 60 }, { kind: 'sustain', down: false }]) {
    const { rooms, join } = setup(); join('a');
    rooms.command('a', 'claim', { assetId: 'piano' });
    rooms.command('a', 'piano', { kind: 'on', midi: 60 });
    if (cleanup.kind === 'sustain') {
      rooms.command('a', 'piano', { kind: 'sustain', down: true });
      rooms.command('a', 'piano', { kind: 'off', midi: 60 });
    }
    for (let i = 0; i < 200; i++) rooms.command('a', 'piano', { kind: 'off', midi: 21 });
    assert.equal(rooms.command('a', 'piano', { kind: 'on', midi: 64 }).ok, false);
    assert.equal(rooms.command('a', 'piano', cleanup).ok, true);
    assert.deepEqual(rooms.getState('407')!.notes.piano, []);
    assert.equal(rooms.getState('407')!.occupancy.piano, 'a');
  }
});
