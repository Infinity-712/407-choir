import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,MeshStandardMaterial,SphereGeometry} from 'three';
import {simplifyRoomGeometry} from '../shared/simplify-room-geometry.ts';
import {RoomGeometryLOD} from '../src/scene/RoomGeometryLOD.ts';

test('room LOD reduces dense spheres with bounded world error and unchanged inputs', async()=>{
  const geometry=new SphereGeometry(1,96,64);
  const indices=Uint32Array.from(geometry.index!.array);
  const positions=Float32Array.from(geometry.attributes.position.array);
  const beforeIndices=indices.slice(),beforePositions=positions.slice();
  const result=await simplifyRoomGeometry(indices,positions,1);
  assert.ok(result.indices.length<indices.length);
  assert.equal(result.indices.length%3,0);
  assert.ok(result.worldError<=0.0015);
  assert.ok(result.indices.every(index=>index<positions.length/3));
  assert.deepEqual(indices,beforeIndices);
  assert.deepEqual(positions,beforePositions);
  const large=await simplifyRoomGeometry(indices,positions,10);
  assert.ok(large.worldError<=0.0015);
  assert.ok(large.indices.length>=result.indices.length,'larger world scale needs more detail');
  geometry.dispose();
});

test('room LOD rejects invalid scale before simplification', async()=>{
  await assert.rejects(simplifyRoomGeometry(new Uint32Array([0,1,2]),new Float32Array(9),0),/scale/);
});

test('room LOD reconnects identical exported corners without merging attribute seams',async()=>{
  const geometry=new SphereGeometry(1,64,32).toNonIndexed();
  const positions=Float32Array.from(geometry.attributes.position.array);
  const indices=Uint32Array.from({length:positions.length/3},(_,i)=>i);
  const normals=Float32Array.from(geometry.attributes.normal.array);
  const before=indices.slice();
  const result=await simplifyRoomGeometry(indices,positions,1,{values:normals,stride:3});
  assert.ok(result.indices.length<indices.length*.9,'disconnected exported triangles should simplify');
  assert.deepEqual(indices,before);
  const seamValues=new Float32Array(indices.length);
  for(let i=0;i<seamValues.length;i++)seamValues[i]=i;
  const seams=await simplifyRoomGeometry(indices,positions,1,{values:seamValues,stride:1});
  assert.equal(seams.indices.length,indices.length,'different attributes at a corner must remain separate');
});

test('room LOD queues copies lazily, respects quality switches, and restores original index on dispose',()=>{
  const previous=globalThis.Worker;
  let worker:FakeWorker|undefined;
  class FakeWorker{
    onmessage?: (event:{data:{id:number;indices:Uint32Array;worldError:number}})=>void;
    jobs:{id:number;indices:Uint32Array;positions:Float32Array;worldScale:number}[]=[];
    terminated=false;
    constructor(){worker=this;}
    postMessage(job:FakeWorker['jobs'][number]){this.jobs.push(job);}
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=FakeWorker as unknown as typeof Worker;
  try{
    const root=new Group(),geometry=new SphereGeometry(1,64,32),original=geometry.index!;
    const mesh=new Mesh(geometry,new MeshStandardMaterial());
    root.scale.set(2,1,1);mesh.rotation.z=Math.PI/4;
    root.add(mesh);
    const lod=new RoomGeometryLOD(root);
    assert.equal(worker,undefined);
    lod.setLow(true);
    assert.equal(worker!.jobs.length,1);
    const job=worker!.jobs[0];
    assert.ok(job.worldScale>=2-1e-10,'nested nonuniform scale and rotation must not understate world error');
    assert.notEqual(job.indices.buffer,original.array.buffer);
    assert.notEqual(job.positions.buffer,geometry.attributes.position.array.buffer);
    lod.setLow(false);
    worker!.onmessage!({data:{id:job.id,indices:job.indices.slice(0,300),worldError:0.001}});
    assert.equal(geometry.index,original,'late worker result cannot change standard quality');
    lod.setLow(true);
    assert.equal(geometry.index!.count,300);
    assert.equal(lod.statistics.processedMeshes,1);
    lod.dispose();
    assert.equal(geometry.index,original);
    assert.equal(worker!.terminated,true);
  }finally{globalThis.Worker=previous;}
});

test('room LOD skips interactive keys, transparent materials, grouped geometry and avatars',()=>{
  const root=new Group();
  const key=new Mesh(new SphereGeometry(1,64,32),new MeshStandardMaterial());key.userData.midi=60;
  const transparent=new Mesh(new SphereGeometry(1,64,32),new MeshStandardMaterial({transparent:true}));
  const grouped=new Mesh(new SphereGeometry(1,64,32),new MeshStandardMaterial());grouped.geometry.addGroup(0,300,0);
  const avatar=new Group();avatar.userData.avatarId='test';avatar.add(new Mesh(new SphereGeometry(1,64,32),new MeshStandardMaterial()));
  root.add(key,transparent,grouped,avatar);
  const lod=new RoomGeometryLOD(root);
  assert.equal(lod.statistics.originalTriangles,0);
  lod.dispose();
});
