import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGameChairs,getMinigameLayout,GAME_CENTER,GAME_WALK_RADIUS,type MusicalChairsState} from '../shared/minigames.ts';
import {canStand,groundHeight} from '../shared/movement.ts';
import type {RoomLayout} from '../shared/protocol.ts';

const layout=JSON.parse(readFileSync(new URL('../public/assets/interaction-layout.json',import.meta.url),'utf8')) as RoomLayout;
const game=(phase:MusicalChairsState['phase']='music'):MusicalChairsState=>({kind:'musical-chairs',gameId:'test',phase,hostId:'a',participants:['a','b','c','d','e','f'],roster:{},alive:['a','b','c','d','e','f'],eliminated:[],round:1,chairs:createGameChairs('test',1,6),seats:{},movement:{},phaseStartedAt:1000,phaseEndsAt:null,musicVariant:0,winnerId:null,singerId:null,lastEliminatedId:null,message:null,teleportVersion:1});
test('active game replaces only conductor obstacles with N-1 real game chair colliders',()=>{
  const source=JSON.stringify(layout),state=game(),effective=getMinigameLayout(layout,state);
  assert.equal(state.chairs.length,5);assert.equal(effective.assets.length,layout.assets.length-1+5);
  assert.ok(!effective.assets.some(asset=>asset.id==='conductor'));
  assert.ok(!effective.colliders.some(c=>c.id==='Conductor lectern'||c.id==='Conductor adjustable round stool'));
  for(const chair of state.chairs){assert.ok(!canStand(effective,chair.position[0],chair.position[2]));assert.ok(canStand(effective,chair.approach[0],chair.approach[2]));assert.equal(groundHeight(effective,chair.approach[0],chair.approach[2]),0);}
  for(let i=0;i<6;i++){const angle=i*Math.PI*2/6;assert.ok(canStand(effective,GAME_CENTER[0]+Math.sin(angle)*GAME_WALK_RADIUS,GAME_CENTER[2]+Math.cos(angle)*GAME_WALK_RADIUS));}
  assert.equal(JSON.stringify(layout),source,'base layout must remain immutable');
});
test('finished/lobby games restore the original assets and a new round cannot retain old chairs',()=>{
  assert.equal(getMinigameLayout(layout,null),layout);assert.equal(getMinigameLayout(layout,game('lobby')),layout);assert.equal(getMinigameLayout(layout,game('finished')),layout);
  const first=game(),next={...first,round:2,chairs:createGameChairs('test',2,5)};
  assert.equal(next.chairs.length,4);assert.ok(getMinigameLayout(layout,next).assets.every(asset=>!first.chairs.some(old=>old.id===asset.id)));
  assert.equal(createGameChairs('other',1,2).length,1);
});
