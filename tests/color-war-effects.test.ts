import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {COLOR_WAR_RULES} from '../shared/color-war.ts';
import {ColorWarEffects} from '../src/minigames/ColorWarEffects.ts';
import type {RoomLayout,RoomState} from '../shared/protocol.ts';

const layout:RoomLayout={version:1,bounds:{minX:-5,maxX:5,minZ:-5,maxZ:5},spawn:[0,0,0],assets:[],colliders:[],floors:[]};
test('color effects expire, remove their own scene graph and dispose resources exactly once',()=>{
  const scene=new THREE.Scene(),existing=new THREE.Group();scene.add(existing);
  const effects=new ColorWarEffects(scene,layout);
  const state={players:{},serverTime:1000,colorWar:{phase:'playing',members:{},projectiles:[],splashes:[{id:'s',team:'S',position:[0,0,0],friendly:false,expiresAt:2000}],event:null}} as unknown as RoomState;
  effects.setState(state,'a');effects.update(1000);
  let meshes=0,disposed=0;
  scene.traverse(node=>{if(node instanceof THREE.Mesh){meshes++;node.geometry.addEventListener('dispose',()=>disposed++);}});
  assert.ok(meshes>0);
  effects.update(2001);
  assert.equal(effects.statistics.splashes,0);
  effects.dispose();effects.dispose();
  assert.deepEqual(scene.children,[existing]);assert.equal(disposed,meshes);
});
test('color effects bound incoming projectiles and clear them when the game ends',()=>{
  const scene=new THREE.Scene(),effects=new ColorWarEffects(scene,layout);
  const state={players:{},serverTime:1000,colorWar:{phase:'playing',members:{},projectiles:Array.from({length:500},(_,id)=>({id:String(id),team:'P',position:[0,1,0],velocity:[1,1,0],bornAt:1000})),splashes:Array.from({length:200},(_,id)=>({id:'s'+id,team:'P',position:[0,0,0],friendly:false,expiresAt:2000})),event:null}} as unknown as RoomState;
  effects.setState(state,'a');effects.update(1000);
  assert.equal(effects.statistics.projectiles,COLOR_WAR_RULES.maxProjectiles);
  assert.equal(effects.statistics.splashes,COLOR_WAR_RULES.maxSplashes);
  state.colorWar!.phase='finished';effects.setState(state,'a');
  assert.equal(effects.statistics.projectiles,0);effects.dispose();assert.equal(scene.children.length,0);
});
