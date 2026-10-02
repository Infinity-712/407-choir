import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PianoKeyBatch } from '../src/scene/PianoKeyBatch.ts';

function fixture() {
  const root = new THREE.Group();root.position.set(2, 3, 4);root.rotation.y = .3;
  const parent = new THREE.Group();parent.position.set(1, .2, -2);parent.rotation.set(.2, .5, -.3);parent.scale.set(2, .8, 1.2);root.add(parent);
  const material = new THREE.MeshStandardMaterial();
  const keys = ['a', 'a', 'b', 'b'].map((instrumentId, i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.1, .03, .3), material);
    mesh.position.set(i * .2, .1, 0);mesh.rotation.y = .2;
    mesh.userData = { instrumentId, midi: 60 + i % 2 };parent.add(mesh);return mesh;
  });
  const other = new THREE.Mesh(new THREE.BoxGeometry(), material);root.add(other);root.updateMatrixWorld(true);
  return { root, parent, material, keys, other };
}
function vertices(mesh: THREE.Mesh) { return Array.from({length:mesh.geometry.attributes.position.count}, (_, i) => new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld)); }
function close(a:THREE.Vector3,b:THREE.Vector3){assert.ok(a.distanceTo(b)<1e-5,`${a.toArray()} != ${b.toArray()}`);}

test('batches retain transformed vertices and independent instrument/key motion with conservative bounds', () => {
  const {root,parent,keys,other}=fixture();const original=keys.map(vertices);
  const displacement=new THREE.Vector3(0,-.008,0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(parent.matrixWorld));
  const batch=new PianoKeyBatch(root);assert.deepEqual(batch.statistics,{sourceMeshes:4,batchMeshes:2});
  assert.equal(other.parent,root);assert.ok(keys.every(key=>key.parent===null));root.updateMatrixWorld(true);
  const meshes=root.children.filter((o):o is THREE.Mesh=>o instanceof THREE.Mesh&&o!==other);
  meshes.forEach((mesh,g)=>vertices(mesh).forEach((v,i)=>close(v,original[g*2+Math.floor(i/24)][i%24])));
  assert.equal(batch.setKey('a',60,true),true);assert.equal(batch.setKey('missing',60,true),false);
  const attribute=meshes[0].geometry.getAttribute('position') as THREE.BufferAttribute;
  assert.deepEqual(attribute.updateRanges,[{start:0,count:72}]);const version=attribute.version;
  batch.setKey('a',60,true);assert.equal(attribute.version,version);
  vertices(meshes[0]).forEach((v,i)=>close(v,original[Math.floor(i/24)][i%24].clone().add(i<24?displacement:new THREE.Vector3())));
  vertices(meshes[1]).forEach((v,i)=>close(v,original[2+Math.floor(i/24)][i%24]));
  for(const mesh of meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++)assert.ok(mesh.geometry.boundingBox!.containsPoint(new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i)));
  batch.setKey('b',60,true);batch.clear('a');vertices(meshes[0]).forEach((v,i)=>close(v,original[Math.floor(i/24)][i%24]));
  batch.clear();vertices(meshes[1]).forEach((v,i)=>close(v,original[2+Math.floor(i/24)][i%24]));batch.dispose();
});

test('disposal preserves shared source geometry and materials and removes owned geometry exactly once',()=>{
  const {root,keys,material,other}=fixture();other.geometry.dispose();other.geometry=keys[0].geometry;
  let sourceDisposals=0,materialDisposals=0;keys[0].geometry.addEventListener('dispose',()=>sourceDisposals++);material.addEventListener('dispose',()=>materialDisposals++);
  const batch=new PianoKeyBatch(root);let mergedDisposals=0;root.children.forEach(o=>{if(o instanceof THREE.Mesh&&o!==other)o.geometry.addEventListener('dispose',()=>mergedDisposals++);});
  batch.dispose();batch.dispose();assert.equal(mergedDisposals,2);assert.equal(sourceDisposals,0);assert.equal(materialDisposals,0);assert.equal(batch.setKey('a',60,true),false);assert.equal(other.parent,root);
});

test('baking retains UVs and transformed normals; incompatible and mirrored keys stay available',()=>{
  const {root,keys}=fixture();
  const inverse=root.matrixWorld.clone().invert();
  const originals=keys.map(key=>key.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,key.matrixWorld)));
  const batch=new PianoKeyBatch(root);const meshes=root.children.filter((o):o is THREE.Mesh=>o instanceof THREE.Mesh&&o.name.startsWith('piano-key-batch:'));
  meshes.forEach((mesh,g)=>['normal','uv'].forEach(name=>{
    const actual=mesh.geometry.getAttribute(name);const expected=[...originals[g*2].getAttribute(name).array,...originals[g*2+1].getAttribute(name).array];
    assert.deepEqual([...actual.array],expected);
  }));batch.dispose();originals.forEach(geometry=>geometry.dispose());
  const second=fixture();second.keys[0].scale.x=-1;second.keys[1].geometry.setDrawRange(0,3);
  const partial=new PianoKeyBatch(second.root);assert.deepEqual(partial.statistics,{sourceMeshes:2,batchMeshes:1});
  assert.equal(second.keys[0].parent,second.parent);assert.equal(second.keys[1].parent,second.parent);partial.dispose();
});
