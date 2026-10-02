import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomController } from '../server/room.ts';
import { canStand, stepPosition } from '../shared/movement.ts';
import type { RoomLayout, Vec3 } from '../shared/protocol.ts';

const room = JSON.parse(readFileSync(new URL('../public/assets/interaction-layout.json', import.meta.url), 'utf8')) as RoomLayout;

test('clock-aligned columns are removed from seating, collisions and picking', () => {
  const removed = new Set(Array.from({ length: 4 }, (_, row) => [8, 9, 10].map(col => `chair_R0${row + 1}_C${String(col).padStart(2, '0')}`)).flat());
  assert.equal(room.assets.filter(asset => asset.type === 'chair').length, 56);
  assert.equal(room.assets.length, 61);
  assert.equal(room.assets.reduce((sum, asset) => sum + (asset.hitBoxes?.length ?? 0), 0), 65);
  assert.ok(room.assets.every(asset => !removed.has(asset.id)));
  assert.ok(room.colliders.every(collider => !collider.id || !removed.has(collider.id)));
  assert.deepEqual(room.spawn, [-.6, 0, -.6]);
});

test('continuous walking climbs all four terraces and returns through the central aisle', () => {
  for (const fps of [15, 30, 60, 144]) for (const speed of [2.6, 3.8]) for (const x of [-.6, 0, .6]) {
    const layout = { ...room, spawn: [x, 0, -.6] as Vec3 };
    let now = 0, sentAt = -100, position: Vec3 = [...layout.spawn], via: Vec3[] = [];
    const server = new RoomController(layout, { now: () => now });
    assert.equal(server.join('walker', { name: 'Walker', roomId: 'stairs' }).ok, true);
    const levels = new Set<number>([0]);
    const send = () => {
      const result = server.command('walker', 'move', { position, yaw: 0, via });
      assert.equal(result.ok, true, `${fps} FPS, ${speed} m/s, x=${x}: ${result.error}`);
      sentAt = now; via = [];
    };
    for (const destination of [-4.82, -.6]) {
      for (let frame = 0; Math.abs(position[2] - destination) > 1e-6 && frame < fps * 12; frame++) {
        const remaining = destination - position[2];
        const travel = Math.sign(remaining) * Math.min(Math.abs(remaining), speed * Math.min(.05, 1 / fps));
        const next = stepPosition(layout, position, [x, position[1], position[2] + travel]);
        assert.ok(Math.abs(next[2] - position[2]) > 1e-6, `${fps} FPS, ${speed} m/s, x=${x}: blocked at ${position}`);
        position = next; via.push([...position]); levels.add(position[1]); now += 1000 / fps;
        if (now - sentAt > 80 || via.length >= 28) send();
      }
      assert.ok(Math.abs(position[2] - destination) < 1e-6, 'walking must reach both ends of the aisle');
      send();
    }
    assert.deepEqual([...levels].sort((a, b) => a - b), [0, .234, .454, .674, .894]);
    assert.equal(position[1], 0);
    const authoritative = server.getState('stairs')!.players.walker.position;
    assert.ok(Math.hypot(...position.map((value, i) => value - authoritative[i])) < 1e-6);
  }
});

test('the podium blocks walking and sixteen entrants receive clear separate spawn positions', () => {
  const podium = room.assets.find(asset => asset.type === 'conductor')!.hitBoxes![0];
  assert.equal(canStand(room, (podium.min[0] + podium.max[0]) / 2, (podium.min[2] + podium.max[2]) / 2), false);
  const server = new RoomController(room);
  const positions: Vec3[] = [];
  for (let index = 0; index < 16; index++) {
    const id = `entrant-${index}`;
    const result = server.join(id, { name: `Guest ${index}`, roomId: 'entrance' });
    assert.equal(result.ok, true, result.error);
    const position = result.state!.players[id].position;
    assert.equal(canStand(room, position[0], position[2]), true);
    assert.ok(positions.every(other => Math.hypot(other[0] - position[0], other[2] - position[2]) >= .55));
    positions.push(position);
  }
});
