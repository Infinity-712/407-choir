import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomController } from '../server/room.ts';
import { canStand, findPath, groundHeight, stepPosition } from '../shared/movement.ts';
import type { RoomLayout, Vec3 } from '../shared/protocol.ts';

const exported = JSON.parse(readFileSync(new URL('../public/assets/interaction-layout.json', import.meta.url), 'utf8')) as RoomLayout;
const corner: RoomLayout = {
  version: 1, bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 }, spawn: [-.7, 0, -.4],
  floors: [], colliders: [{ min: [-.5, -.5], max: [.5, .5] }], assets: [],
};
function setup(layout: RoomLayout) {
  let now = 0;
  const rooms = new RoomController(layout, { now: () => now });
  const joined = rooms.join('walker', { name: 'Walker', roomId: 'navigation' });
  assert.equal(joined.ok, true);
  return { rooms, advance: (ms: number) => { now += ms; }, position: () => rooms.getState('navigation')!.players.walker.position };
}

test('the server enforces polygon room walls and radius clearance on movement samples',()=>{
  const room:RoomLayout={...corner,spawn:[.4,0,0],colliders:[],footprint:[[-3,-3],[3,-3],[3,3]]};
  const {rooms,advance,position}=setup(room);
  advance(100);
  assert.equal(rooms.command('walker','move',{position:[.2,0,0],yaw:0}).ok,false,'center is inside but avatar crosses diagonal');
  assert.deepEqual(position(),room.spawn);
  assert.equal(rooms.command('walker','move',{position:[.3,0,0],yaw:0}).ok,true);
});

test('sampled movement preserves a legal turn around a furniture corner', () => {
  const { rooms, advance, position } = setup(corner);
  advance(100);
  assert.equal(rooms.command('walker', 'move', { position: [-.4, 0, -.7], yaw: 0 }).ok, false);
  const result = rooms.command('walker', 'move', { position: [-.4, 0, -.7], yaw: 0, via: [[-.7, 0, -.7]] });
  assert.equal(result.ok, true, result.error);
  assert.ok(Math.hypot(position()[0] + .4, position()[2] + .7) < 1e-9);
});

test('movement samples cannot cross furniture or bypass travel speed', () => {
  const { rooms } = setup(corner);
  assert.equal(rooms.command('walker', 'move', { position: [-.4, 0, -.7], yaw: 0, via: [[0, 0, 0]] }).ok, false);
  assert.equal(rooms.command('walker', 'move', { position: [-.7, 0, -.4], yaw: 0, via: [[-.7, 0, -1.2], [-1.2, 0, -1.2]] }).ok, false);
  assert.equal(rooms.command('walker', 'move', { position: [-.7, 0, -.4], yaw: 0, via: Array.from({ length: 33 }, () => [-.7, 0, -.4]) }).ok, false);
  assert.equal(rooms.command('walker', 'move', { position: [-.7, 0, -.4], yaw: 0, via: [[NaN, 0, -.4]] }).ok, false);
});

test('a rejected movement returns the current authoritative pose and permits recovery', () => {
  const { rooms, advance } = setup(corner);
  const rejected = rooms.command('walker', 'move', { position: [0, 0, 0], yaw: 1 });
  assert.equal(rejected.ok, false);
  const corrected = rejected.state?.players.walker;
  assert.ok(corrected, 'the client needs the pose from this rejection rather than an earlier broadcast');
  assert.deepEqual(corrected.position, [-.7, 0, -.4]);
  advance(100);
  const result = rooms.command('walker', 'move', { position: [-.7, 0, -.7], yaw: corrected.yaw, via: [corrected.position] });
  assert.equal(result.ok, true, result.error);
});

test('resynchronization observes later accepted movement after a delayed rejection', () => {
  const { rooms, advance } = setup(corner);
  const rejected = rooms.command('walker', 'move', { position: [0, 0, 0], yaw: 1 });
  assert.equal(rejected.ok, false);
  advance(100);
  assert.equal(rooms.command('walker', 'move', { position: [-.7, 0, -.7], yaw: .5 }).ok, true);
  // This request is sent after the delayed rejection arrives, behind all moves
  // already on the socket, so its snapshot must not roll the newer move back.
  const synchronized = rooms.command('walker', 'sync', {});
  assert.equal(synchronized.ok, true);
  const player = synchronized.state?.players.walker;
  assert.ok(player);
  assert.ok(Math.abs(player.position[2] + .7) < 1e-9);
  assert.equal(player.yaw, .5);
});

test('every piano bench blocks walking while its approach remains clear', () => {
  for (const piano of exported.assets.filter(asset => asset.type === 'piano')) {
    assert.equal(canStand(exported, piano.position[0], piano.position[2]), false, `${piano.id} bench footprint`);
    assert.equal(canStand(exported, piano.approach[0], piano.approach[2]), true, `${piano.id} approach`);
    const start: Vec3 = [...piano.approach];
    const reached = stepPosition(exported, start, [piano.position[0], start[1], piano.position[2]]);
    assert.equal(canStand(exported,reached[0],reached[2]),true,`${piano.id} movement must finish in clear floor space`);
    assert.ok(Math.hypot(reached[0]-piano.position[0],reached[2]-piano.position[2])>.18, `${piano.id} must stop the avatar before the stool`);
  }
});

test('different approach routes remain synchronized through turns before claiming', () => {
  const targets = exported.assets.map(asset => asset.id);
  const starts: Vec3[] = [exported.spawn, [-4, 0, 2], [4, 0, 1.4]];
  for (const start of starts) for (const target of targets) {
    assert.equal(canStand(exported,start[0],start[2]),true,`route origin ${start} must be walkable`);
    const layout = { ...exported, spawn: [start[0], groundHeight(exported, start[0], start[2]), start[2]] as Vec3 };
    const asset = layout.assets.find(a => a.id === target)!;
    const { rooms, advance, position } = setup(layout);
    let local = [...layout.spawn] as Vec3, via: Vec3[] = [], elapsed = 0, sentAt = -100;
    const path = findPath(layout, local, asset.approach);
    assert.ok(path.length, `${target} from ${start}`);
    let frame = 0;
    while (path.length && frame++ < 1800) {
      while (path.length && Math.hypot(path[0][0] - local[0], path[0][2] - local[2]) < .025) path.shift();
      if (!path.length) break;
      const p = path[0], dx = p[0] - local[0], dz = p[2] - local[2], distance = Math.hypot(dx, dz);
      if (distance) {
        const travel = Math.min(distance, 2.6 / 60);
        local = stepPosition(layout, local, [local[0] + dx / distance * travel, local[1], local[2] + dz / distance * travel]);
        via.push([...local] as Vec3);
      }
      elapsed += 1000 / 60; advance(1000 / 60);
      if (elapsed - sentAt > 80) {
        sentAt = elapsed;
        const result = rooms.command('walker', 'move', { position: local, yaw: 0, via });
        assert.equal(result.ok, true, `${target} from ${start}: ${result.error}`);
        via = [];
      }
    }
    assert.equal(path.length, 0, `${target} route stalled`);
    const finalMove = rooms.command('walker', 'move', { position: local, yaw: 0, via });
    assert.equal(finalMove.ok, true, finalMove.error);
    assert.ok(Math.hypot(position()[0] - local[0], position()[2] - local[2]) < .001);
    const claim = rooms.command('walker', 'claim', { assetId: target });
    assert.equal(claim.ok, true, `${target} from ${start}: ${claim.error}`);
  }
});

test('flushing the last local movement makes an interaction at the distance boundary succeed', () => {
  const layout: RoomLayout = { ...corner, spawn: [-1.1, 0, 0], colliders: [], assets: [{ id: 'seat', type: 'chair', label: 'Seat', position: [0, .5, 0], approach: [0, 0, 0], rotation: 0, radius: 1 }] };
  const { rooms, advance } = setup(layout);
  assert.equal(rooms.command('walker', 'claim', { assetId: 'seat' }).ok, false);
  advance(80);
  assert.equal(rooms.command('walker', 'move', { position: [-.95, 0, 0], yaw: 0, via: [[-1.02, 0, 0], [-.95, 0, 0]] }).ok, true);
  assert.equal(rooms.command('walker', 'claim', { assetId: 'seat' }).ok, true);
});
