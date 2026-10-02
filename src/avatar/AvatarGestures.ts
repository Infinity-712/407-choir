import * as THREE from 'three';
import type { ChoirPose, RoomState } from '../../shared/protocol.ts';

export type ConductorAnimationState = Pick<RoomState['conductor'], 'beats' | 'bpm' | 'playing' | 'startAt' | 'gesture' | 'gestureAt'>;
type Hands = [THREE.Vector3 | null, THREE.Vector3 | null];
const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const gestureEase = (value: number) => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Rig order is negative X (character's right), positive X (character's left). */
export function choirHands(pose: ChoirPose): Hands {
  const raised = (side: number) => point(side * .35, .89, .09);
  const chest = (side: number) => point(-side * .028, .722, .152);
  switch (pose) {
    case 'raise-left': return [null, raised(1)];
    case 'raise-right': return [raised(-1), null];
    case 'raise-both': return [raised(-1), raised(1)];
    case 'hand-left-chest': return [null, chest(1)];
    case 'hand-right-chest': return [chest(-1), null];
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
const HAND_AXIS = new THREE.Vector3(0, -.109, .005).normalize();
const upperLength = .146;
const lowerLength = Math.hypot(.109, .005);
const direction = new THREE.Vector3();
const bend = new THREE.Vector3();
const elbow = new THREE.Vector3();
const lowerDirection = new THREE.Vector3();
const lowerWorld = new THREE.Quaternion();
const inverseUpper = new THREE.Quaternion();

/** Two-link targeting preserves limb lengths and bends the elbow ahead of the shirt. */
export function aimArm(arm: THREE.Group, forearm: THREE.Group, target: THREE.Vector3, side: number, conducting=false): void {
  direction.copy(target).sub(arm.position);
  // Keep the conducting elbow softly bent (20–125 degrees), never folded
  // tight against the upper arm or locked straight at the edge of reach.
  const reach=(flexion:number)=>Math.sqrt(upperLength**2+lowerLength**2+2*upperLength*lowerLength*Math.cos(THREE.MathUtils.degToRad(flexion)));
  const distance = THREE.MathUtils.clamp(direction.length(), conducting?reach(125):.015, conducting?reach(20):upperLength + lowerLength - .001);
  direction.normalize();
  // Conductors carry the elbow below the hand. The old forward pole put
  // the elbow ahead of the wrist and made the forearm fold back unnaturally.
  if(conducting)bend.set(side*.15,-1,-.3);
  else bend.set(side * .35, -.45, 1);
  bend.addScaledVector(direction, -bend.dot(direction)).normalize();
  const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
  elbow.copy(direction).multiplyScalar(along).addScaledVector(bend, height);
  arm.quaternion.setFromUnitVectors(DOWN, elbow.clone().normalize());
  lowerDirection.copy(direction).multiplyScalar(distance).sub(elbow).normalize();
  lowerWorld.setFromUnitVectors(HAND_AXIS, lowerDirection);
  inverseUpper.copy(arm.quaternion).invert();
  forearm.quaternion.copy(inverseUpper).multiply(lowerWorld);
}

/** One ictus per beat: down/up; down/out/up; down/in/out/up. */
export function conductorHands(state: ConductorAnimationState | undefined, now: number): [THREE.Vector3, THREE.Vector3] {
  const rest: [THREE.Vector3, THREE.Vector3] = [point(-.24, .70, .18), point(.24, .70, .18)];
  if (!state) return rest;
  const beats = state.beats === 2 || state.beats === 3 ? state.beats : 4;
  const bpm = Number.isFinite(state.bpm) ? THREE.MathUtils.clamp(state.bpm, 30, 240) : 84;
  const phase = Math.max(0, now - state.startAt) * bpm / 60_000;
  const paths = {
    2: [point(.19, .65, .16), point(.35, .89, .12)],
    3: [point(.19, .65, .16), point(.38, .71, .14), point(.35, .89, .12)],
    4: [point(.19, .65, .16), point(.055, .70, .18), point(.38, .71, .14), point(.35, .89, .12)],
  };
  let hands = rest;
  if (state.playing) {
    const index = Math.floor(phase) % beats;
    const fraction = phase % 1;
    const right = paths[beats][index].clone().lerp(paths[beats][(index + 1) % beats], gestureEase(fraction));
    // A little rebound gives the beat a readable lift rather than a rigid polygon.
    right.y += Math.sin(fraction * Math.PI) * .012;
    hands = [point(-.285, .68 + Math.sin(phase * Math.PI * 2) * .025, .13), right];
  }
  const age = Math.max(0, now - state.gestureAt);
  if (state.gesture === 'cue' && age < 1200) {
    const lift = gestureEase(age / 700);
    const exit = gestureEase((age - 750) / 450);
    for (let index = 0; index < 2; index++) {
      const side = index ? 1 : -1;
      const cue = rest[index].clone().lerp(point(side * .35, .89, .09), lift);
      hands[index] = cue.lerp(hands[index], exit);
    }
  } else if ((state.gesture === 'crescendo' || state.gesture === 'diminuendo') && age < 2400) {
    const progress = gestureEase(age / 2000);
    const growing = state.gesture === 'crescendo';
    const amount = growing ? progress : 1 - progress;
    const envelope = gestureEase(age / 300) * (1 - gestureEase((age - 2000) / 400));
    const left = point(-.28, THREE.MathUtils.lerp(.70, .86, amount), .17);
    hands[0].lerp(left, envelope);
    const center = point(.25, .73, .13);
    const amplitude = THREE.MathUtils.lerp(.65, 1.18, amount);
    hands[1].sub(center).multiplyScalar(THREE.MathUtils.lerp(1, amplitude, envelope)).add(center);
  } else if (state.gesture === 'cutoff' && age < 900) {
    const circle = Math.min(1, age / 650) * Math.PI * 2;
    const exit = gestureEase((age - 620) / 280);
    for (let index = 0; index < 2; index++) {
      const side = index ? 1 : -1;
      hands[index] = point(side * (.285 + Math.sin(circle) * .055), .73 + Math.cos(circle) * .065, .13).lerp(rest[index], exit);
    }
  }
  // Paths above use positive outward coordinates; map the beat to the
  // character's actual right hand, with the expressive left hand opposite.
  return [hands[1].setX(-hands[1].x), hands[0].setX(-hands[0].x)];
}
