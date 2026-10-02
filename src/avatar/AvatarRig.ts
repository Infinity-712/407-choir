import * as THREE from 'three';
import { sanitizeAvatar } from '../../shared/avatar.ts';
import { DEFAULT_AVATAR, type AvatarConfig, type ChoirPose, type Emote, type Mode } from '../../shared/protocol.ts';
import { aimArm, choirHands, conductorHands, gestureEase, type ConductorAnimationState } from './AvatarGestures.ts';

export type AvatarAnimationState = { mode: Mode; speed: number; emote: Emote | null; pose?: ChoirPose | null; poseAt?: number; now?: number; conductor?: ConductorAnimationState };
export type AvatarInstance = { group: THREE.Group; animate(time: number, state: AvatarAnimationState): void; dispose(): void };

export const AVATAR_METRICS = { headCenter: 1.065, standingHeight: 1.43, seatDrop: 0.33, chairSeatForward: 0.19 } as const;

/** Root faces +Z. Its origin is the soles when standing, and the seat when sitting. */
export function createAvatar(input: AvatarConfig = DEFAULT_AVATAR): AvatarInstance {
  const config = sanitizeAvatar(input);
  const group = new THREE.Group();
  group.name = 'avatar';
  const body = new THREE.Group();
  group.add(body);
  const upperPivot = new THREE.Group();
  upperPivot.position.y = 0.437;
  body.add(upperPivot);
  const torso = new THREE.Group();
  torso.position.y = -0.437;
  upperPivot.add(torso);
  const head = new THREE.Group();
  head.position.y = AVATAR_METRICS.headCenter;
  torso.add(head);

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  const geo = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.add(geometry); return geometry; };
  const mat = (color: string, roughness = 0.9) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    materials.add(material);
    return material;
  };
  const skin = mat(config.skin);
  const hair = mat(config.hairColor);
  const shirt = mat(config.shirtColor);
  const pants = mat(config.pantsColor);
  const ink = mat('#332b34', 0.7);
  const cream = mat('#fff9eb');
  const sole = mat('#e1d8c9');
  const accent = mat('#f0b7c3');
  const sphere = geo(new THREE.SphereGeometry(1, 32, 24));
  const capsule = geo(new THREE.CapsuleGeometry(1, 1, 8, 20));

  function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, name?: string) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    object.castShadow = true;
    object.receiveShadow = true;
    if (name) object.name = name;
    parent.add(object);
    return object;
  }
  const ball = (parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, name?: string) => mesh(parent, sphere, material, x, y, z, sx, sy, sz, name);
  function stroke(parent: THREE.Object3D, points: number[][], radius: number, material = ink, name?: string) {
    const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point as [number, number, number])));
    return mesh(parent, geo(new THREE.TubeGeometry(curve, 22, radius, 8, false)), material, 0, 0, 0, 1, 1, 1, name);
  }

  // One continuous, gently tapered garment keeps the silhouette soft at the joints.
  const torsoProfile = new THREE.SplineCurve([
    [0, 0.429], [0.133, 0.429], [0.182, 0.456], [0.192, 0.535],
    [0.182, 0.665], [0.154, 0.776], [0.102, 0.824], [0.064, 0.837], [0, 0.837],
  ].map(([radius, y]) => new THREE.Vector2(radius, y)));
  mesh(torso, geo(new THREE.LatheGeometry(torsoProfile.getPoints(40), 40)), shirt, 0, 0, 0, 1, 1, 0.72, 'garment');
  ball(body, pants, 0, 0.437, -0.005, 0.17, 0.107, 0.114, 'pelvis');
  ball(torso, skin, 0, 0.846, 0, 0.068, 0.072, 0.067);
  if (config.outfit === 'hoodie') {
    ball(torso, shirt, 0, 0.808, -0.065, 0.148, 0.085, 0.107);
    stroke(torso, [[-0.1, 0.797, 0.046], [-0.053, 0.783, 0.093], [0, 0.783, 0.107], [0.053, 0.783, 0.093], [0.1, 0.797, 0.046]], 0.015, shirt);
    stroke(torso, [[-0.08, 0.55, 0.132], [-0.068, 0.523, 0.137], [0, 0.518, 0.143], [0.068, 0.523, 0.137], [0.08, 0.55, 0.132]], 0.005, shirt);
    for (const side of [-1, 1]) {
      stroke(torso, [[side * 0.038, 0.783, 0.099], [side * 0.04, 0.706, 0.129]], 0.0045, cream);
      ball(torso, cream, side * 0.04, 0.703, 0.129, 0.006, 0.011, 0.006);
    }
  } else if (config.outfit === 'overalls') {
    ball(torso, pants, 0, 0.463, 0.009, 0.18, 0.117, 0.134);
    ball(torso, pants, 0, 0.623, 0.113, 0.112, 0.11, 0.032);
    for (const side of [-1, 1]) {
      stroke(torso, [[side * 0.088, 0.798, 0.054], [side * 0.081, 0.75, 0.102], [side * 0.072, 0.677, 0.135]], 0.018, pants);
      ball(torso, cream, side * 0.073, 0.683, 0.153, 0.011, 0.011, 0.004);
    }
    stroke(torso, [[-0.039, 0.626, 0.146], [-0.032, 0.591, 0.147], [0, 0.582, 0.147], [0.032, 0.591, 0.147], [0.039, 0.626, 0.146]], 0.0035, cream);
  } else {
    mesh(torso, geo(new THREE.TorusGeometry(0.067, 0.009, 8, 32)), cream, 0, 0.826, 0, 1, 1, 1).rotation.x = Math.PI / 2;
    ball(torso, cream, 0.063, 0.691, 0.118, 0.022, 0.021, 0.004);
  }

  // Pivoted limbs support walking, hanging legs and seated keyboard reach.
  const arms: THREE.Group[] = [];
  const forearms: THREE.Group[] = [];
  const legs: THREE.Bone[] = [];
  const shins: THREE.Bone[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.163, 0.781, 0);
    torso.add(arm);
    arms.push(arm);
    const longSleeve = config.outfit === 'hoodie';
    mesh(arm, capsule, shirt, 0, -0.063, 0, 0.067, longSleeve ? 0.071 : 0.05, 0.063);
    const forearm = new THREE.Group();
    forearm.position.y = -0.146;
    arm.add(forearm);
    forearms.push(forearm);
    mesh(forearm, capsule, longSleeve ? shirt : skin, 0, -0.039, 0, 0.048, 0.048, 0.046);
    ball(forearm, skin, 0, -0.109, 0.005, 0.047, 0.054, 0.045, side < 0 ? 'hand-right' : 'hand-left');
    const leg = new THREE.Bone();
    leg.position.set(side * 0.084, 0.418, 0);
    body.add(leg);
    legs.push(leg);
    const shin = new THREE.Bone();
    shin.position.y = -0.165;
    leg.add(shin);
    shins.push(shin);
    // A single weighted trouser leg bends at the knee without a visible seam.
    const trouser = geo(new THREE.CapsuleGeometry(0.071, 0.246, 10, 24, 8));
    trouser.translate(side * 0.084, 0.279, 0);
    const legPositions = trouser.attributes.position;
    const skinIndices: number[] = [];
    const skinWeights: number[] = [];
    for (let vertex = 0; vertex < legPositions.count; vertex++) {
      const y = legPositions.getY(vertex);
      const taper = THREE.MathUtils.mapLinear(y, 0.085, 0.473, 0.9, 1.08);
      legPositions.setX(vertex, side * 0.084 + (legPositions.getX(vertex) - side * 0.084) * taper);
      const lowerWeight = 1 - THREE.MathUtils.smoothstep(y, 0.217, 0.289);
      skinIndices.push(0, 1, 0, 0);
      skinWeights.push(1 - lowerWeight, lowerWeight, 0, 0);
    }
    trouser.computeVertexNormals();
    trouser.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    trouser.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    const trouserMesh = new THREE.SkinnedMesh(trouser, pants);
    trouserMesh.name = side < 0 ? 'trouser-left' : 'trouser-right';
    trouserMesh.castShadow = true;
    trouserMesh.receiveShadow = true;
    // Poses extend beyond the rest bounds; their tiny meshes are cheap to draw.
    trouserMesh.frustumCulled = false;
    body.add(trouserMesh);
    body.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton([leg, shin]);
    skeletons.add(skeleton);
    trouserMesh.bind(skeleton);
    ball(shin, cream, 0, -0.202, 0.034, 0.082, 0.05, 0.114, 'shoe');
    ball(shin, sole, 0, -0.226, 0.035, 0.082, 0.027, 0.113);
    stroke(shin, [[-0.025, -0.169, 0.081], [0, -0.163, 0.088], [0.025, -0.169, 0.081]], 0.004, cream);
  }

  // A pear-shaped face is a single smooth surface, with slightly fuller low cheeks.
  const width = config.faceWidth;
  const faceGeometry = geo(new THREE.SphereGeometry(1, 48, 32));
  const facePosition = faceGeometry.attributes.position;
  for (let index = 0; index < facePosition.count; index++) {
    const y = facePosition.getY(index);
    const fullness = 1 - y * 0.085;
    facePosition.setXYZ(index, facePosition.getX(index) * fullness, y, facePosition.getZ(index) * (1 - y * 0.035));
  }
  faceGeometry.computeVertexNormals();
  mesh(head, faceGeometry, skin, 0, 0, 0, 0.271 * width, 0.281, 0.246, 'face');
  for (const side of [-1, 1]) {
    ball(head, skin, side * 0.264 * width, -0.043, -0.002, 0.043, 0.058, 0.041);
    ball(head, accent, side * 0.282 * width, -0.043, 0.026, 0.012, 0.027, 0.01);
  }
  const faceZ = (x: number, y: number) => 0.246 * (1 - y / 0.281 * 0.035) * Math.sqrt(Math.max(0.08, 1 - (x / (0.271 * width * (1 - y / 0.281 * 0.085))) ** 2 - (y / 0.281) ** 2));
  const blush = mat('#e99294');
  blush.transparent = true;
  blush.opacity = config.cheek * 0.62;
  blush.depthWrite = false;
  const eyes: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.name = side > 0 ? 'eye-right' : 'eye-left';
    const eyeX = side * 0.091 * config.eyeSpacing * width;
    eye.position.set(eyeX, -0.015, faceZ(eyeX, -0.015) + 0.004);
    eye.rotation.y = side * 0.16;
    eye.scale.setScalar(config.eyeSize);
    head.add(eye);
    eyes.push(eye);
    ball(eye, ink, 0, 0, 0, 0.021, 0.032, 0.01);
    ball(eye, cream, -0.006, 0.009, 0.009, 0.0055, 0.007, 0.0025);
    const brow = [[eyeX - 0.021, 0.061], [eyeX, 0.07], [eyeX + 0.021, 0.064]];
    stroke(head, brow.map(([x, y]) => [x, y, faceZ(x, y) + 0.005]), 0.0045, hair);
    if (config.cheek > 0) {
      const cheekX = side * 0.153 * width;
      const cheek = ball(head, blush, cheekX, -0.081, faceZ(cheekX, -0.081) + 0.004, 0.038, 0.018, 0.005);
      cheek.rotation.set(0.22, side * 0.5, 0);
    }
  }
  ball(head, skin, 0, -0.069, faceZ(0, -0.069), 0.018, 0.015, 0.017);
  if (config.mouth === 'smile') {
    stroke(head, [[-0.032, -0.112], [-0.017, -0.125], [0, -0.128], [0.017, -0.125], [0.032, -0.112]].map(([x, y]) => [x, y, faceZ(x, y) + 0.004]), 0.0045);
  } else if (config.mouth === 'cat') {
    stroke(head, [[-0.038, -0.113], [-0.019, -0.125], [0, -0.113], [0.019, -0.125], [0.038, -0.113]].map(([x, y]) => [x, y, faceZ(x, y) + 0.004]), 0.0045);
  } else {
    ball(head, ink, 0, -0.12, faceZ(0, -0.12) + 0.004, 0.011, 0.014, 0.005);
  }

  // The cap has a continuous shaped hairline. Flattened, tapered locks lie along
  // that surface; their direction changes the cut without rows of sausage curls.
  const capVertices: number[] = [];
  const capIndices: number[] = [];
  const radial = 64;
  const rings = 24;
  for (let ring = 0; ring <= rings; ring++) {
    for (let segment = 0; segment <= radial; segment++) {
      const phi = segment / radial * Math.PI * 2;
      const front = Math.pow(Math.max(0, Math.cos(phi)), 2.3);
      const backEdge = config.hairStyle === 'bob' ? 2.48 : config.hairStyle === 'crop' ? 1.91 : 2.03;
      const frontEdge = config.hairStyle === 'bob' ? 1.045 + Math.sin(phi * 5 + 0.45) * 0.065 : config.hairStyle === 'swoop' ? 0.91 + Math.sin(phi + 0.3) * 0.24 : 0.98 + Math.sin(phi * 3) * 0.07;
      const theta = (backEdge * (1 - front) + frontEdge * front) * ring / rings;
      const flare = config.hairStyle === 'bob' ? 1 + Math.pow(ring / rings, 4) * (1 - front) * 0.055 : 1;
      capVertices.push(Math.sin(phi) * Math.sin(theta) * 0.287 * width * flare, Math.cos(theta) * 0.301 + 0.012, Math.cos(phi) * Math.sin(theta) * 0.264 - 0.009);
      if (ring < rings && segment < radial) {
        const a = ring * (radial + 1) + segment;
        const b = a + radial + 1;
        capIndices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const cap = geo(new THREE.BufferGeometry());
  cap.setAttribute('position', new THREE.Float32BufferAttribute(capVertices, 3));
  cap.setIndex(capIndices);
  cap.computeVertexNormals();
  hair.side = THREE.DoubleSide;
  mesh(head, cap, hair, 0, 0, 0, 1, 1, 1, 'hair-cap');

  function lock(points: number[][], breadth: number, thickness = 0.021) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x * width, y, z)));
    const positions: number[] = [];
    const indices: number[] = [];
    const lengthSegments = 24;
    const sides = 12;
    for (let step = 0; step <= lengthSegments; step++) {
      const t = step / lengthSegments;
      const center = curve.getPoint(t);
      const tangent = curve.getTangent(t);
      const lateral = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
      const profile = Math.pow(Math.sin(Math.PI * t), 0.7);
      for (let side = 0; side <= sides; side++) {
        const angle = side / sides * Math.PI * 2;
        const point = center.clone().addScaledVector(lateral, Math.cos(angle) * breadth * profile * width);
        const shellFront = Math.sqrt(Math.max(0.001, 1 - (point.x / (0.287 * width)) ** 2 - ((point.y - 0.012) / 0.301) ** 2)) * 0.264 - 0.009;
        const quiff = THREE.MathUtils.smoothstep(point.y, 0.28, 0.325);
        point.z = THREE.MathUtils.lerp(shellFront, center.z, quiff) + (0.2 + Math.sin(angle)) * thickness * profile;
        positions.push(point.x, point.y, point.z);
        if (step < lengthSegments && side < sides) {
          const a = step * (sides + 1) + side;
          const b = a + sides + 1;
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
    const geometry = geo(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    mesh(head, geometry, hair, 0, 0, 0, 1, 1, 1, 'hair-lock');
  }
  if (config.hairStyle === 'bob') {
    lock([[-0.11, 0.279, 0.108], [-0.07, 0.226, 0.209], [0.025, 0.169, 0.247], [0.082, 0.135, 0.241]], 0.062);
    lock([[-0.16, 0.248, 0.117], [-0.183, 0.174, 0.183], [-0.234, 0.067, 0.145], [-0.253, -0.108, 0.07]], 0.05);
    lock([[0.119, 0.258, 0.132], [0.178, 0.182, 0.19], [0.226, 0.069, 0.151], [0.257, -0.105, 0.068]], 0.046);
  } else if (config.hairStyle === 'crop') {
    lock([[-0.186, 0.178, 0.148], [-0.093, 0.25, 0.18], [0.025, 0.282, 0.121], [0.084, 0.34, 0.032]], 0.06);
    lock([[-0.07, 0.266, 0.142], [0.039, 0.227, 0.211], [0.116, 0.177, 0.222], [0.172, 0.156, 0.18]], 0.045);
  } else if (config.hairStyle === 'buns') {
    for (const side of [-1, 1]) {
      const bun = ball(head, hair, side * 0.255 * width, 0.236, -0.035, 0.097, 0.099, 0.093);
      bun.rotation.z = side * 0.25;
      const tie = mesh(head, geo(new THREE.TorusGeometry(0.063, 0.008, 8, 24)), shirt, side * 0.253 * width, 0.219, 0.032);
      tie.rotation.y = side * 0.55;
      lock([[side * 0.028, 0.293, 0.079], [side * 0.097, 0.233, 0.192], [side * 0.186, 0.151, 0.203], [side * 0.235, 0.079, 0.139]], 0.039);
    }
  } else {
    lock([[-0.153, 0.248, 0.112], [-0.054, 0.255, 0.185], [0.093, 0.202, 0.232], [0.219, 0.108, 0.164]], 0.076, 0.026);
    lock([[-0.19, 0.213, 0.125], [-0.224, 0.129, 0.157], [-0.251, -0.012, 0.08]], 0.031);
  }

  if (config.accessory === 'glasses') {
    for (const side of [-1, 1]) {
      mesh(head, geo(new THREE.TorusGeometry(0.059, 0.006, 8, 32)), ink, side * 0.091 * config.eyeSpacing * width, -0.015, 0.257, 1.08, 0.96, 1);
      stroke(head, [[side * (0.091 * config.eyeSpacing * width + 0.062), -0.002, 0.255], [side * 0.261 * width, 0.003, 0.135], [side * 0.285 * width, -0.006, 0.002]], 0.006);
    }
    const bridge = 0.091 * config.eyeSpacing * width - 0.06;
    stroke(head, [[-bridge, -0.008, 0.258], [0, 0.001, 0.263], [bridge, -0.008, 0.258]], 0.0055);
  } else if (config.accessory === 'headphones') {
    stroke(head, [[-0.298 * width, -0.029, -0.016], [-0.28 * width, 0.212, -0.03], [0, 0.329, -0.035], [0.28 * width, 0.212, -0.03], [0.298 * width, -0.029, -0.016]], 0.02, cream);
    for (const side of [-1, 1]) {
      ball(head, ink, side * 0.288 * width, -0.036, 0, 0.037, 0.083, 0.069);
      ball(head, shirt, side * 0.313 * width, -0.036, 0, 0.03, 0.069, 0.06);
    }
  } else if (config.accessory === 'bow') {
    const bow = new THREE.Group();
    bow.position.set(0.207 * width, 0.227, 0.169);
    bow.rotation.z = -0.35;
    head.add(bow);
    for (const side of [-1, 1]) {
      const loop = ball(bow, shirt, side * 0.039, 0, 0, 0.046, 0.038, 0.023);
      loop.rotation.z = side * 0.25;
    }
    ball(bow, cream, 0, 0, 0.016, 0.016);
  }

  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, -0.07);
  heartShape.bezierCurveTo(-0.2, 0.065, -0.105, 0.2, 0, 0.105);
  heartShape.bezierCurveTo(0.105, 0.2, 0.2, 0.065, 0, -0.07);
  const heart = mesh(group, geo(new THREE.ExtrudeGeometry(heartShape, { depth: 0.025, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.008, bevelThickness: 0.008, curveSegments: 10 })), accent, 0, 1.04, 0.34);
  heart.visible = false;
  let disposed = false;
  const joints = [...arms, ...forearms];
  const previousArms = joints.map(joint => joint.quaternion.clone());
  const transitionArms = joints.map(joint => joint.quaternion.clone());
  let lastPose: ChoirPose | null = null;
  let lastEmote: Emote | null = null;
  let lastMode: Mode = 'walk';
  let transitionAt = -Infinity;
  let transitionDuration = 0;

  const animate = (time: number, state: AvatarAnimationState) => {
    if (disposed) return;
    const t = Number.isFinite(time) ? time : 0;
    const now = Number.isFinite(state.now) ? state.now! : t * 1000;
    const handsReserved = state.mode === 'piano' || state.mode === 'conduct';
    const pose = handsReserved ? null : state.pose ?? null;
    const emote = handsReserved ? null : state.emote;
    if (pose !== lastPose || emote !== lastEmote) {
      transitionArms.forEach((rotation, index) => rotation.copy(previousArms[index]));
      transitionAt = pose !== lastPose && Number.isFinite(state.poseAt) ? state.poseAt! : now;
      transitionDuration = emote !== lastEmote ? (emote ? 180 : 400) : pose ? 1200 : 500;
    }
    if (handsReserved || lastMode === 'piano' || lastMode === 'conduct') transitionDuration = 0;
    const speed = Number.isFinite(state.speed) ? THREE.MathUtils.clamp(state.speed, 0, 1) : 0;
    const sitting = state.mode === 'sit' || state.mode === 'piano';
    const walking = state.mode === 'walk' && speed > 0.02;
    const stride = Math.sin(t * 9) * speed;
    body.position.y = sitting ? -AVATAR_METRICS.seatDrop : walking ? Math.abs(Math.sin(t * 9)) * 0.022 * speed : 0;
    // The room's chair anchor is near the cushion center. With short toy legs,
    // the hips sit toward its front so the knees fold beyond the .2165m edge.
    body.position.z = state.mode === 'sit' ? AVATAR_METRICS.chairSeatForward : 0;
    body.rotation.set(0, 0, walking ? Math.sin(t * 9) * 0.025 * speed : Math.sin(t * 1.6) * 0.008);
    upperPivot.rotation.x = state.mode === 'piano' ? 0.35 : 0;
    head.rotation.set(Math.sin(t * 1.7) * 0.02, Math.sin(t * 1.1) * 0.04, 0);
    const blinkPhase = t % 4.7;
    const blink = blinkPhase > 4.48 ? Math.max(0.08, Math.abs(blinkPhase - 4.59) / 0.11) : 1;
    for (const eye of eyes) eye.scale.y = config.eyeSize * blink;
    for (let index = 0; index < 2; index++) {
      const side = index === 0 ? -1 : 1;
      arms[index].rotation.set(walking ? side * stride * 0.42 : 0, 0, side * 0.1);
      arms[index].scale.y = state.mode === 'piano' ? 1.65 : 1;
      forearms[index].rotation.set(-0.05, 0, 0);
      legs[index].rotation.set(sitting ? -Math.PI / 2 : -side * stride * 0.42, 0, 0);
      shins[index].rotation.set(sitting ? Math.PI / 2 : Math.max(0, side * stride) * 0.35, 0, 0);
      if (state.mode === 'piano') {
        arms[index].rotation.set(-1.55 + Math.sin(t * 7 + index * 2) * 0.018, 0, -side * 0.12);
        forearms[index].rotation.x = -0.32 + Math.sin(t * 9 + index * 2) * 0.035;
        head.rotation.x = 0.07;
      }
    }
    const targets = state.mode === 'conduct' ? conductorHands(state.conductor, now) : pose ? choirHands(pose) : null;
    targets?.forEach((target, index) => {
      if (target) aimArm(arms[index], forearms[index], target, index ? 1 : -1, state.mode === 'conduct');
    });
    if (emote === 'wave') {
      arms[1].rotation.set(0, 0, 2.25 + Math.sin(t * 11) * 0.22);
      forearms[1].rotation.z = -0.45;
      head.rotation.z = -0.09;
    } else if (emote === 'clap') {
      for (let index = 0; index < 2; index++) {
        arms[index].rotation.set(-1.03, 0, (index === 0 ? 1 : -1) * (0.39 + Math.sin(t * 11) * 0.19));
        forearms[index].rotation.x = -0.48;
      }
    } else if (emote === 'heart') {
      for (let index = 0; index < 2; index++) {
        arms[index].rotation.set(-0.83, 0, (index === 0 ? 1 : -1) * 0.48);
        forearms[index].rotation.x = -0.86;
      }
      head.rotation.z = Math.sin(t * 2) * 0.08;
    }
    if (transitionDuration > 0) {
      const mix = gestureEase((now - transitionAt) / transitionDuration);
      joints.forEach((joint, index) => joint.quaternion.slerp(transitionArms[index], 1 - mix));
    }
    joints.forEach((joint, index) => previousArms[index].copy(joint.quaternion));
    lastPose = pose;
    lastEmote = emote;
    lastMode = state.mode;
    heart.visible = emote === 'heart';
    heart.position.z = 0.34 + body.position.z;
    heart.position.y = 0.85 + body.position.y + Math.sin(t * 3) * 0.025;
    heart.scale.setScalar(0.8 + Math.sin(t * 4) * 0.07);
  };
  animate(0, { mode: 'walk', speed: 0, emote: null });
  return {
    group,
    animate,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const skeleton of skeletons) skeleton.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
