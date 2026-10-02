import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { interactionTargets } from '../src/scene/interactionTargets.ts';
import type { RoomLayout } from '../shared/protocol.ts';

test('visible piano ends, benches and conductor desk can be selected at their real positions',()=>{
  const layout=JSON.parse(readFileSync(new URL('../public/assets/interaction-layout.json',import.meta.url),'utf8')) as RoomLayout;
  const targets=interactionTargets(layout.assets);
  targets.forEach(mesh=>mesh.updateMatrixWorld(true));
  const hit=(origin:number[],direction:number[])=>new THREE.Raycaster(new THREE.Vector3(...origin),new THREE.Vector3(...direction).normalize()).intersectObjects(targets,false)[0]?.object.userData.asset.id;
  const pianos=layout.assets.filter(asset=>asset.type==='piano');
  assert.deepEqual(pianos.map(asset=>asset.id).sort(),['piano-black','piano-brown','piano-digital-black','piano-third-black']);
  for(const asset of [...pianos,...layout.assets.filter(asset=>asset.type==='conductor')]){
    assert.equal(asset.hitBoxes?.length,asset.type==='piano'?2:1,`${asset.id} needs furniture picking bounds`);
    for(const box of asset.hitBoxes!){
      // A click on the visible top of either body or bench must select its own
      // instrument, including after furniture moves or changes orientation.
      const x=(box.min[0]+box.max[0])/2,z=(box.min[2]+box.max[2])/2;
      assert.equal(hit([x,box.max[1]+.25,z],[0,-1,0]),asset.id,`${asset.id} body/bench top`);
    }
  }
  // 56 chairs, four piano bodies + benches, and the conductor desk.
  assert.equal(targets.length,65);
  assert.ok(targets.every(mesh=>!mesh.visible));
  for(const mesh of targets){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}
});

test('all four exported instruments retain every separately animated MIDI key',()=>{
  const glb=readFileSync(new URL('../public/assets/room.glb',import.meta.url));
  assert.equal(glb.readUInt32LE(0),0x46546c67,'valid GLB magic');
  assert.equal(glb.readUInt32LE(16),0x4e4f534a,'first GLB chunk contains JSON');
  const document=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString('utf8')) as {nodes:{mesh?:number;extras?:{midi?:number;instrumentId?:string}}[]};
  for(const id of ['piano-black','piano-brown','piano-third-black','piano-digital-black']){
    const keys=document.nodes.filter(node=>node.extras?.instrumentId===id&&node.extras.midi!==undefined);
    assert.equal(keys.length,88,`${id} must have 88 key nodes`);
    assert.ok(keys.every(node=>node.mesh!==undefined),`${id} keys must be renderable meshes`);
    assert.deepEqual(keys.map(node=>node.extras!.midi!).sort((a,b)=>a-b),Array.from({length:88},(_,i)=>i+21),`${id} exact MIDI range`);
  }
});
