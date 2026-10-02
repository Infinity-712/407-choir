import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createAvatar, type AvatarAnimationState } from '../src/avatar/AvatarRig.ts';

const BASE_TIME = 1_000_000;
const idle: AvatarAnimationState = { mode: 'walk', speed: 0, emote: null };
test('hand names use the character perspective while the face points toward positive Z', () => {
  const avatar=createAvatar();
  assert.ok(hand(avatar,'right').x<0);
  assert.ok(hand(avatar,'left').x>0);
  avatar.dispose();
});
function hand(avatar: ReturnType<typeof createAvatar>, side: 'left' | 'right') {
  avatar.group.updateMatrixWorld(true);
  return avatar.group.getObjectByName(`hand-${side}`)!.getWorldPosition(new Vector3());
}

test('choir arm lifts rise gradually, hold at shoulder height, and mirror correctly', () => {
  for (const side of ['left', 'right'] as const) {
    const avatar = createAvatar();
    const state: AvatarAnimationState = { ...idle, pose: `raise-${side}`, poseAt: BASE_TIME };
    avatar.animate(0, { ...state, now: BASE_TIME });
    const start = hand(avatar, side);
    avatar.animate(0, { ...state, now: BASE_TIME + 600 });
    const middle = hand(avatar, side);
    avatar.animate(0, { ...state, now: BASE_TIME + 1400 });
    const raised = hand(avatar, side);
    assert.ok(middle.y > start.y + .06 && middle.y < raised.y - .04, `${side}: gradual lift`);
    assert.ok(raised.y > .84 && Math.abs(raised.x) > .30, `${side}: ${raised.toArray()}`);
    assert.ok(hand(avatar, side === 'left' ? 'right' : 'left').y < .6, 'opposite arm remains relaxed');
    avatar.animate(0, { ...state, now: BASE_TIME + 10_000 });
    assert.ok(hand(avatar, side).distanceTo(raised) < 1e-7, 'held pose does not replay its entrance');
    avatar.dispose();
  }
});

test('hand-to-chest poses cross onto the opposite chest without reaching into the face', () => {
  const positions: Vector3[] = [];
  for (const side of ['left', 'right'] as const) {
    const avatar = createAvatar();
    avatar.animate(0, { ...idle, pose: `hand-${side}-chest`, poseAt: BASE_TIME, now: BASE_TIME + 2000 });
    const palm = hand(avatar, side);
    assert.ok(side === 'left' ? palm.x < -.015 : palm.x > .015, `${side}: opposite chest ${palm.toArray()}`);
    assert.ok(palm.y > .68 && palm.y < .76 && palm.z > .135, 'palm sits on chest, below chin and ahead of garment');
    positions.push(palm);
    avatar.dispose();
  }
  assert.ok(Math.abs(positions[0].x + positions[1].x) < 1e-7);
  assert.ok(Math.abs(positions[0].y - positions[1].y) < 1e-7);
});

test('toggle off and ending a temporary emote blend back to the intended pose', () => {
  const avatar = createAvatar();
  const state: AvatarAnimationState = { ...idle, pose: 'raise-both', poseAt: BASE_TIME };
  avatar.animate(0, { ...state, now: BASE_TIME + 1500 });
  const held = hand(avatar, 'right');
  avatar.animate(0, { ...state, emote: 'clap', now: BASE_TIME + 1600 });
  avatar.animate(0, { ...state, emote: 'clap', now: BASE_TIME + 1900 });
  assert.ok(hand(avatar, 'right').distanceTo(held) > .1);
  avatar.animate(0, { ...state, now: BASE_TIME + 2000 });
  avatar.animate(0, { ...state, now: BASE_TIME + 2450 });
  assert.ok(hand(avatar, 'right').distanceTo(held) < .001, 'emote restores persistent arm pose');
  avatar.animate(0, { ...idle, pose: null, poseAt: BASE_TIME + 2600, now: BASE_TIME + 2600 });
  const exitStart = hand(avatar, 'right');
  avatar.animate(0, { ...idle, pose: null, poseAt: BASE_TIME + 2600, now: BASE_TIME + 2850 });
  const exitMiddle = hand(avatar, 'right');
  avatar.animate(0, { ...idle, pose: null, poseAt: BASE_TIME + 2600, now: BASE_TIME + 3200 });
  assert.ok(exitStart.distanceTo(held) < .001, 'release starts from current hand position');
  assert.ok(exitMiddle.y < exitStart.y && exitMiddle.y > hand(avatar, 'right').y, 'release eases down');
  avatar.dispose();
});

test('held upper-body poses leave sitting and walking legs intact and never override piano reach', () => {
  const avatar = createAvatar();
  const baseline = createAvatar();
  for (const mode of ['walk', 'sit', 'piano'] as const) {
    const state: AvatarAnimationState = { mode, speed: .8, emote: null, now: BASE_TIME + 2000 };
    baseline.animate(.4, state);
    avatar.animate(.4, { ...state, pose: 'raise-both', poseAt: BASE_TIME });
    avatar.group.updateMatrixWorld(true);
    baseline.group.updateMatrixWorld(true);
    for (const name of ['pelvis', 'shoe', 'trouser-left']) {
      assert.deepEqual(avatar.group.getObjectByName(name)!.matrixWorld.elements, baseline.group.getObjectByName(name)!.matrixWorld.elements);
    }
    if (mode === 'piano') assert.ok(hand(avatar, 'right').distanceTo(hand(baseline, 'right')) < 1e-7);
  }
  avatar.dispose(); baseline.dispose();
});

test('conducting beats follow server time, tempo and distinct two/three/four-beat paths', () => {
  function sample(beats: 2 | 3 | 4, elapsed: number, bpm = 60) {
    const avatar = createAvatar();
    avatar.animate(0, { mode: 'conduct', speed: 0, emote: null, now: BASE_TIME + elapsed, conductor: { beats, bpm, playing: true, startAt: BASE_TIME, gesture: 'beat', gestureAt: BASE_TIME } });
    const point = hand(avatar, 'right'); avatar.dispose(); return point;
  }
  for (const beats of [2, 3, 4] as const) {
    assert.ok(sample(beats, 725).distanceTo(sample(beats, 362.5, 120)) < 1e-7, 'doubling tempo halves beat duration');
    assert.ok(sample(beats, 0).distanceTo(sample(beats, beats * 1000)) < 1e-7, 'bar repeats');
  }
  assert.ok(sample(3, 1000).x < -.3, 'three-beat second beat goes outward');
  assert.ok(sample(4, 1000).x > -.1, 'four-beat second beat goes inward');
  assert.ok(sample(2, 1000).y > sample(2, 0).y + .2, 'two-beat upbeat is visible');
});

test('conductor cue, dynamics and cutoff are finite one-shots that return to beat or rest', () => {
  const base = { beats: 4 as const, bpm: 84, startAt: BASE_TIME, gestureAt: BASE_TIME };
  for (const gesture of ['cue', 'crescendo', 'diminuendo', 'cutoff'] as const) {
    const avatar = createAvatar();
    const baseline = createAvatar();
    const playing = gesture !== 'cutoff';
    const sample = (now: number, name = gesture) => avatar.animate(0, { mode: 'conduct', speed: 0, emote: null, now, conductor: { ...base, playing, gesture: name } });
    sample(BASE_TIME + 450);
    const active = hand(avatar, 'left');
    baseline.animate(0, { mode: 'conduct', speed: 0, emote: null, now: BASE_TIME + 450, conductor: { ...base, playing, gesture: 'beat' } });
    assert.ok(active.distanceTo(hand(baseline, 'left')) > .015, `${gesture} must be visible`);
    sample(BASE_TIME + 3500);
    baseline.animate(0, { mode: 'conduct', speed: 0, emote: null, now: BASE_TIME + 3500, conductor: { ...base, playing, gesture: 'beat' } });
    assert.ok(hand(avatar, 'left').distanceTo(hand(baseline, 'left')) < 1e-7, `${gesture} returns to base`);
    avatar.group.traverse(object => assert.ok(object.matrixWorld.elements.every(Number.isFinite)));
    avatar.dispose(); baseline.dispose();
  }
});

test('conducting keeps elbows below wrists, forearms forward, and elbow flexion bounded throughout each gesture', () => {
  const avatar=createAvatar();
  for(const beats of [2,3,4] as const)for(const gesture of ['beat','cue','crescendo','diminuendo','cutoff'] as const)for(const playing of [false,true]){
    for(let elapsed=0;elapsed<=4000;elapsed+=25){
      avatar.animate(0,{mode:'conduct',speed:0,emote:null,now:BASE_TIME+elapsed,conductor:{beats,bpm:120,playing,startAt:BASE_TIME,gesture,gestureAt:BASE_TIME}});
      avatar.group.updateMatrixWorld(true);
      for(const side of ['right','left'] as const){
        const palm=avatar.group.getObjectByName(`hand-${side}`)!;
        const wrist=palm.getWorldPosition(new Vector3());
        const elbow=palm.parent!.getWorldPosition(new Vector3());
        const shoulder=palm.parent!.parent!.getWorldPosition(new Vector3());
        const flexion=shoulder.clone().sub(elbow).negate().angleTo(wrist.clone().sub(elbow))*180/Math.PI;
        const context=`${beats}/${gesture}/${playing}/${elapsed}/${side}`;
        assert.ok(wrist.z>elbow.z+.015,`forearm must extend forward: ${context}`);
        assert.ok(elbow.y<wrist.y+.025,`elbow must hang below wrist: ${context}`);
        assert.ok(flexion>=19&&flexion<=126,`elbow flexion ${flexion}: ${context}`);
      }
    }
  }
  avatar.dispose();
});
