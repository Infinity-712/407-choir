import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type KeyRange = { attribute: THREE.BufferAttribute; start: number; neutral: Float32Array; delta: THREE.Vector3; down: boolean };

/** Bakes compatible keys into room-local meshes. Dispose BEFORE disposing the room:
 * this removes/disposes owned batch geometry; room materials remain room-owned.
 * Keys not successfully batched remain in the scene for the normal mesh fallback.
 */
export class PianoKeyBatch {
  readonly statistics = { sourceMeshes: 0, batchMeshes: 0 };
  private keys = new Map<string, KeyRange>();
  private meshes: THREE.Mesh[] = [];

  constructor(root: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const groups = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>();
    const identities = new Map<string, number>();
    root.traverse(object => {
      if (object.userData.midi !== undefined) {
        const id = `${object.userData.instrumentId}:${object.userData.midi}`;
        identities.set(id, (identities.get(id) ?? 0) + 1);
      }
    });
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh || Array.isArray(object.material)) return;
      const { instrumentId, midi } = object.userData;
      const geometry = object.geometry as THREE.BufferGeometry;
      if (typeof instrumentId !== 'string' || !Number.isInteger(midi) || identities.get(`${instrumentId}:${midi}`) !== 1 || object.children.length || !object.visible) return;
      if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity || Object.keys(geometry.morphAttributes).length || !(geometry.attributes.position instanceof THREE.BufferAttribute) || geometry.attributes.position.itemSize !== 3 || geometry.attributes.position.normalized) return;
      // Mirrored transforms change face winding; retain their original draw path.
      if (new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld).determinant() <= 0) return;
      for (let parent = object.parent; parent && parent !== root; parent = parent.parent) if (!parent.visible) return;
      const attributes = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b));
      if (attributes.some(([, attribute]) => !(attribute instanceof THREE.BufferAttribute))) return;
      const signature = attributes.map(([name, attribute]) => [name, attribute.itemSize, attribute.normalized, attribute.array.constructor.name]);
      const key = JSON.stringify([instrumentId, object.material.uuid, !!geometry.index, signature, object.castShadow, object.receiveShadow, object.renderOrder, object.layers.mask]);
      const list = groups.get(key) ?? [];list.push(object);groups.set(key, list);
    });
    const removed = new Set<THREE.BufferGeometry>();
    for (const sources of groups.values()) {
      if (sources.length < 2) continue;
      const geometries = sources.map(source => source.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, source.matrixWorld)));
      const merged = mergeGeometries(geometries, false);
      geometries.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, sources[0].material);
      mesh.name = `piano-key-batch:${sources[0].userData.instrumentId}`;
      mesh.userData.pianoKeyBatch = true;
      mesh.castShadow = sources[0].castShadow;mesh.receiveShadow = sources[0].receiveShadow;
      mesh.renderOrder = sources[0].renderOrder;mesh.layers.mask = sources[0].layers.mask;
      const position = merged.getAttribute('position') as THREE.BufferAttribute;
      position.setUsage(THREE.DynamicDrawUsage);
      merged.computeBoundingBox();
      let start = 0;
      for (const source of sources) {
        const count = source.geometry.attributes.position.count;
        const neutral = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) { neutral[i * 3] = position.getX(start + i);neutral[i * 3 + 1] = position.getY(start + i);neutral[i * 3 + 2] = position.getZ(start + i); }
        const parentMatrix = new THREE.Matrix4().multiplyMatrices(inverse, source.parent!.matrixWorld);
        const delta = new THREE.Vector3(0, -.008, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentMatrix));
        this.keys.set(`${source.userData.instrumentId}:${source.userData.midi}`, { attribute: position, start, neutral, delta, down: false });
        for (let i = 0; i < count; i++) merged.boundingBox!.expandByPoint(new THREE.Vector3(neutral[i * 3], neutral[i * 3 + 1], neutral[i * 3 + 2]).add(delta));
        start += count;removed.add(source.geometry);source.removeFromParent();
      }
      // A sphere enclosing the entire neutral/pressed box stays valid while keys move.
      merged.boundingBox!.expandByScalar(1e-5); // Covers Float32 rounding when writing pressed positions.
      merged.boundingSphere = merged.boundingBox!.getBoundingSphere(new THREE.Sphere());
      root.add(mesh);this.meshes.push(mesh);this.statistics.sourceMeshes += sources.length;this.statistics.batchMeshes++;
    }
    // Exported keys may share geometry with unbatched objects.
    root.traverse(object => { if (object instanceof THREE.Mesh) removed.delete(object.geometry); });
    removed.forEach(geometry => geometry.dispose());
  }

  setKey(instrumentId: string, midi: number, down: boolean): boolean {
    const key = this.keys.get(`${instrumentId}:${midi}`);
    if (!key) return false;
    if (key.down === down) return true;
    const { attribute, start, neutral, delta } = key;
    for (let i = 0; i < neutral.length / 3; i++) attribute.setXYZ(start + i, neutral[i * 3] + (down ? delta.x : 0), neutral[i * 3 + 1] + (down ? delta.y : 0), neutral[i * 3 + 2] + (down ? delta.z : 0));
    // The renderer clears ranges after upload. Keep each key's pending range once.
    if (!attribute.updateRanges.some(range => range.start === start * 3 && range.count === neutral.length)) attribute.addUpdateRange(start * 3, neutral.length);
    attribute.needsUpdate = true;key.down = down;return true;
  }

  clear(instrumentId?: string): void {
    for (const [id, key] of this.keys) if (key.down) {
      const separator = id.lastIndexOf(':');const instrument = id.slice(0, separator);
      if (instrumentId === undefined || instrument === instrumentId) this.setKey(instrument, Number(id.slice(separator + 1)), false);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) { mesh.removeFromParent();mesh.geometry.dispose(); }
    this.meshes = [];this.keys.clear();
  }
}
