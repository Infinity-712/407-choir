import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Mesh, Triangle, Vector3 } from 'three';
import { DEFAULT_AVATAR } from '../shared/protocol.ts';
import { sanitizeAvatar, randomAvatar, loadAvatar, saveAvatar } from '../shared/avatar.ts';
import { createAvatar } from '../src/avatar/AvatarRig.ts';

test('untrusted avatar values cannot enter geometry or material parameters', () => {
  assert.deepEqual(sanitizeAvatar(null), DEFAULT_AVATAR);
  assert.deepEqual(sanitizeAvatar([]), DEFAULT_AVATAR);
  const actual = sanitizeAvatar({ skin: 'url(evil)', hairColor: '#ABCDEF', hairStyle: 'bad', faceWidth: NaN, eyeSize: Infinity, eyeSpacing: -200, cheek: 200, extra: true });
  assert.equal(actual.skin, DEFAULT_AVATAR.skin);
  assert.equal(actual.hairColor, '#abcdef');
  assert.equal(actual.hairStyle, DEFAULT_AVATAR.hairStyle);
  assert.equal(actual.faceWidth, DEFAULT_AVATAR.faceWidth);
  assert.equal(actual.eyeSize, DEFAULT_AVATAR.eyeSize);
  assert.equal(actual.eyeSpacing, 0.75);
  assert.equal(actual.cheek, 1);
  assert.equal('extra' in actual, false);
});

test('avatar configurations are independent and randomized values remain renderable', () => {
  const first = sanitizeAvatar(undefined);
  first.skin = '#ffffff';
  assert.equal(sanitizeAvatar(undefined).skin, DEFAULT_AVATAR.skin);
  for (let index = 0; index < 30; index++) {
    const avatar = randomAvatar();
    assert.deepEqual(sanitizeAvatar(avatar), avatar);
    assert.ok(avatar.faceWidth >= 0.8 && avatar.faceWidth <= 1.2);
  }
});

test('local storage corruption and denied storage leave a usable default avatar', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let stored: string | null = '{broken';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => stored, setItem: (_: string, value: string) => { stored = value; } } });
  try {
    assert.deepEqual(loadAvatar(), DEFAULT_AVATAR);
    saveAvatar({ ...DEFAULT_AVATAR, hairStyle: 'buns' });
    assert.equal(loadAvatar().hairStyle, 'buns');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.doesNotThrow(() => saveAvatar(DEFAULT_AVATAR));
    assert.deepEqual(loadAvatar(), DEFAULT_AVATAR);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('standing feet and sitting pelvis use the room anchor and animation stays finite', () => {
  const avatar = createAvatar(DEFAULT_AVATAR);
  avatar.animate(0, { mode: 'walk', speed: 0, emote: null });
  avatar.group.updateMatrixWorld(true);
  let bounds = new Box3().setFromObject(avatar.group, true);
  assert.ok(Math.abs(bounds.min.y) < 0.03, `feet must stay at anchor: ${bounds.min.y}`);
  const standingTop = bounds.max.y;
  assert.ok(standingTop < 1.5, `compact avatar must fit the room furniture: ${standingTop}`);
  avatar.animate(2, { mode: 'sit', speed: 0, emote: null });
  avatar.group.updateMatrixWorld(true);
  bounds = new Box3().setFromObject(avatar.group, true);
  assert.ok(bounds.min.y < -0.1, 'seated feet hang below the chair anchor');
  assert.ok(bounds.max.y < standingTop - 0.3, 'seated root is the seat, not the floor');
  const pelvis = new Box3().setFromObject(avatar.group.getObjectByName('pelvis')!);
  assert.ok(Math.abs(pelvis.min.y) < 0.02, `seated pelvis rests on the anchor: ${pelvis.min.y}`);
  for (const mode of ['walk', 'sit', 'piano', 'conduct'] as const) {
    for (const emote of [null, 'wave', 'clap', 'heart'] as const) {
      avatar.animate(15, { mode, speed: 1, emote });
      avatar.group.updateMatrixWorld(true);
      avatar.group.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite)));
    }
  }
  avatar.dispose();
});

test('every hairstyle keeps the compact standing silhouette and seated anchor', () => {
  for (const hairStyle of ['bob', 'crop', 'buns', 'swoop'] as const) {
    const avatar = createAvatar({ ...DEFAULT_AVATAR, hairStyle });
    avatar.group.updateMatrixWorld(true);
    const standing = new Box3().setFromObject(avatar.group, true);
    assert.ok(standing.max.y > 1.25 && standing.max.y < 1.5, `${hairStyle}: ${standing.max.y}`);
    assert.ok(Math.abs(standing.min.y) < 0.03);
    avatar.animate(0, { mode: 'sit', speed: 0, emote: null });
    avatar.group.updateMatrixWorld(true);
    const sitting = new Box3().setFromObject(avatar.group, true);
    assert.ok(sitting.min.y < -0.15 && sitting.min.y > -0.4, `${hairStyle} seated feet: ${sitting.min.y}`);
    avatar.dispose();
  }
});

test('piano hands reach the keyboard height while the pelvis stays on the seat', () => {
  const avatar = createAvatar(DEFAULT_AVATAR);
  avatar.animate(0, { mode: 'sit', speed: 0, emote: null });
  avatar.animate(0, { mode: 'piano', speed: 0, emote: null });
  avatar.group.updateMatrixWorld(true);
  for (const side of ['left', 'right']) {
    const hand = avatar.group.getObjectByName(`hand-${side}`)!;
    assert.ok(hand, 'hands are part of the articulated rig');
    const position = hand.getWorldPosition(new Vector3());
    assert.ok(position.y > 0.28 && position.y < 0.38, `keyboard hand height: ${position.y}`);
    assert.ok(position.z > 0.48 && position.z < 0.58, `keyboard hand reach: ${position.z}`);
  }
  const pelvis = new Box3().setFromObject(avatar.group.getObjectByName('pelvis')!, true);
  assert.ok(Math.abs(pelvis.min.y) < 0.02);
  avatar.dispose();
});

test('chair pose clears the actual cushion, front frame and backrest at room scale', () => {
  // Source chair R01_C09 bounds relative to seat_anchor; every row uses this template.
  const chairParts = [
    { name: 'cushion', bounds: new Box3(new Vector3(-0.226, -0.048, -0.216), new Vector3(0.226, -0.002211, 0.21)) },
    { name: 'seat shell', bounds: new Box3(new Vector3(-0.231, -0.071, -0.2225), new Vector3(0.231, -0.045, 0.2165)) },
    { name: 'backrest', bounds: new Box3(new Vector3(-0.212, 0.074, -0.309593), new Vector3(0.212, 0.341, -0.235312)) },
  ];
  for (const outfit of ['hoodie', 'tee', 'overalls'] as const) {
    const avatar = createAvatar({ ...DEFAULT_AVATAR, outfit });
    avatar.group.scale.setScalar(0.84);
    for (const time of [0, 2, 5.7]) {
      avatar.animate(time, { mode: 'sit', speed: 0, emote: null });
      avatar.group.updateMatrixWorld(true);
      const contact = avatar.group.getObjectByName('pelvis')!.localToWorld(new Vector3(0, -1, 0));
      assert.ok(Math.abs(contact.y) < 0.003, 'pelvis remains on the seat surface');
      assert.ok(contact.z > -0.19 && contact.z < 0.185, 'pelvis contact remains inside the cushion');
      const collisions: string[] = [];
      const triangle = new Triangle();
      avatar.group.traverse(object => {
        if (!(object instanceof Mesh) || !object.visible) return;
        const index = object.geometry.index;
        const count = index ? index.count : object.geometry.attributes.position.count;
        for (const part of chairParts) {
          for (let vertex = 0; vertex < count; vertex += 3) {
            for (const [corner, target] of [[0, triangle.a], [1, triangle.b], [2, triangle.c]] as const) {
              object.getVertexPosition(index ? index.getX(vertex + corner) : vertex + corner, target).applyMatrix4(object.matrixWorld);
            }
            if (part.bounds.intersectsTriangle(triangle)) {
              collisions.push(`${object.name || object.type} through ${part.name}`);
              break;
            }
          }
        }
      });
      assert.deepEqual(collisions, [], `${outfit} at ${time}: seated geometry must stay outside chair solids`);
    }
    avatar.dispose();
  }
});

test('face controls change actual mesh geometry and every allocated mesh is disposed', () => {
  const narrow = createAvatar({ ...DEFAULT_AVATAR, faceWidth: 0.8, eyeSpacing: 0.75, eyeSize: 0.7 });
  const wide = createAvatar({ ...DEFAULT_AVATAR, faceWidth: 1.2, eyeSpacing: 1.25, eyeSize: 1.35 });
  const narrowFace = new Box3().setFromObject(narrow.group.getObjectByName('face')!);
  const wideFace = new Box3().setFromObject(wide.group.getObjectByName('face')!);
  assert.ok(wideFace.max.x - wideFace.min.x > narrowFace.max.x - narrowFace.min.x);
  assert.ok(wide.group.getObjectByName('eye-right')!.position.x > narrow.group.getObjectByName('eye-right')!.position.x);
  const eyeNarrow = new Box3().setFromObject(narrow.group.getObjectByName('eye-right')!);
  const eyeWide = new Box3().setFromObject(wide.group.getObjectByName('eye-right')!);
  assert.ok(eyeWide.max.y - eyeWide.min.y > eyeNarrow.max.y - eyeNarrow.min.y);
  const geometries = new Set();
  const materials = new Set();
  let disposedGeometry = 0;
  let disposedMaterial = 0;
  wide.group.traverse(object => {
    if (object instanceof Mesh) {
      if (!geometries.has(object.geometry)) { geometries.add(object.geometry); object.geometry.addEventListener('dispose', () => disposedGeometry++); }
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!materials.has(material)) { materials.add(material); material.addEventListener('dispose', () => disposedMaterial++); }
      }
    }
  });
  wide.dispose();
  assert.equal(disposedGeometry, geometries.size);
  assert.equal(disposedMaterial, materials.size);
  narrow.dispose();
});
