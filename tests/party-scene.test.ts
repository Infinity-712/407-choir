import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PartyScene,partyBadge} from '../src/scene/PartyScene.ts';
import {RoomWorld} from '../src/scene/RoomWorld.ts';
import {ColorWarEffects} from '../src/minigames/ColorWarEffects.ts';
import {createGameChairs,type MusicalChairsState} from '../shared/minigames.ts';
import {DEFAULT_AVATAR,type Player,type RoomLayout,type RoomState} from '../shared/protocol.ts';
import {canStand} from '../shared/movement.ts';

function game(phase:MusicalChairsState['phase']='music',round=1):MusicalChairsState{
  return {kind:'musical-chairs',gameId:'test',phase,hostId:'a',participants:['a','b','c'],roster:{},alive:['a','b','c'],eliminated:[],round,chairs:createGameChairs('test',round,3),seats:{},movement:{},phaseStartedAt:0,phaseEndsAt:null,musicVariant:0,winnerId:null,singerId:null,lastEliminatedId:null,message:null,teleportVersion:round};
}

test('party chairs match seat anchors, face outward and keep their geometry within collision footprints',()=>{
  const party=new PartyScene(),state=game();party.setState(state);
  assert.equal(party.group.children.length,2);
  for(const [index,chair] of party.group.children.entries()){
    assert.deepEqual(chair.position.toArray(),[state.chairs[index].position[0],0,state.chairs[index].position[2]]);
    assert.equal(chair.rotation.y,state.chairs[index].rotation);
    const localBounds=new THREE.Box3();chair.children.forEach(child=>{child.updateMatrix();const mesh=child as THREE.Mesh;mesh.geometry.computeBoundingBox();localBounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(child.matrix));});
    assert.ok(localBounds.min.x>=-.236&&localBounds.max.x<=.236);
    assert.ok(localBounds.min.z>=-.221&&localBounds.max.z<=.221);
    const cushion=chair.getObjectByName('party-chair-seat') as THREE.Mesh;
    cushion.geometry.computeBoundingBox();
    assert.ok(Math.abs(cushion.position.y+cushion.geometry.boundingBox!.max.y-.4775)<1e-6);
  }
  party.dispose();
});

test('round changes dispose owned furniture and finishing restores imported furniture visibility',()=>{
  const party=new PartyScene(),room=new THREE.Group(),lectern=new THREE.Mesh(),unrelated=new THREE.Mesh();
  lectern.name='Room_Web Lectern light ash top';room.add(lectern,unrelated);party.setRoom(room);
  party.setState(game());assert.equal(lectern.visible,false);assert.equal(unrelated.visible,true);
  const chair=party.group.children[0],mesh=chair.children[0] as THREE.Mesh;
  let disposed=0;mesh.geometry.addEventListener('dispose',()=>disposed++);
  const same=game('scramble');assert.equal(party.setState(same),false);assert.equal(party.group.children[0],chair);
  assert.equal(party.setState(game('roundEnd',2)),true);assert.equal(disposed,1);
  party.setState(game('finished',2));assert.equal(party.group.children.length,0);assert.equal(lectern.visible,true);
  party.dispose();assert.equal(disposed,1);
});

test('late GLB attachment applies current phase and preserves originally hidden imported nodes',()=>{
  const party=new PartyScene();party.setState(game());const room=new THREE.Group(),stool=new THREE.Mesh();
  stool.name='Room_Web Conductor stool rubber grips';stool.visible=false;room.add(stool);party.setRoom(room);
  assert.equal(stool.visible,false);party.setState(null);assert.equal(stool.visible,false);party.dispose();
});

test('real GLTFLoader node names hide all seven conductor parts and restore their original visibility',async()=>{
  const names=['Room_Web Lectern light ash top','Room_Web Lectern satin white enamel','Room_Web Conductor stool black steel','Room_Web Conductor stool black upholstery','Room_Web Conductor stool bolts','Room_Web Conductor stool molded back shell','Room_Web Conductor stool rubber grips'];
  // No external buffers are needed to exercise the loader's actual node naming.
  const gltf=await new GLTFLoader().parseAsync(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1,2,3,4,5,6,7]}],nodes:[...names.map(name=>({name})),{name:'Room_Web Unrelated furniture'}]}),'');
  const room=gltf.scene,parts=room.children.slice(0,7),other=room.children[7];
  for(const [index,node] of parts.entries()){
    assert.equal(node.userData.name,names[index]);assert.equal(node.name.includes(' '),false);
    node.add(new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshBasicMaterial()));
  }
  parts[4].visible=false;
  // An imported node without extras must still work through its sanitized name.
  delete parts[6].userData.name;
  const party=new PartyScene();party.setState(game());party.setRoom(room);
  assert.deepEqual(parts.map(node=>node.visible),[false,false,false,false,false,false,false]);assert.equal(other.visible,true);
  party.setState(game('finished'));assert.deepEqual(parts.map(node=>node.visible),[true,true,true,true,false,true,true]);
  party.setState(game());party.dispose();assert.deepEqual(parts.map(node=>node.visible),[true,true,true,true,false,true,true]);
  room.traverse(node=>{if(node instanceof THREE.Mesh){node.geometry.dispose();(node.material as THREE.Material).dispose();}});
});

test('singer and champion badges take priority while bystanders have no badge',()=>{
  const state=game('finished');state.winnerId='a';state.singerId='b';state.eliminated=['b'];
  assert.deepEqual(partyBadge(state,'b'),{text:'🎤 被选唱歌',kind:'singer'});
  assert.deepEqual(partyBadge(state,'a'),{text:'🏆 冠军',kind:'winner'});
  assert.equal(partyBadge(state,'visitor'),null);
  state.singerId=null;assert.deepEqual(partyBadge(state,'b'),{text:'观战 · 已淘汰',kind:'eliminated'});
  assert.deepEqual(partyBadge(state,'c'),{text:'抢凳子 · 参与',kind:'participant'});
});

test('clicking a game chair during music does not queue an automatic walk or claim',()=>{
  const state=game(),chair=state.chairs[0],errors:string[]=[],claims:string[]=[];
  // Exercise input policy without constructing a browser WebGL context.
  const world=Object.create(RoomWorld.prototype) as RoomWorld;
  Object.assign(world,{state:{minigame:state,players:{me:{mode:'walk'}}},self:'me',local:new THREE.Vector3(1.3,0,2.28),path:[],pending:null,options:{onError:(text:string)=>errors.push(text),onInteract:(asset:typeof chair)=>claims.push(asset.id)}});
  world.goTo(chair);assert.equal(claims.length,0);assert.equal(errors.length,1);
  assert.deepEqual((world as unknown as {path:unknown[]}).path,[]);
});

test('effective layout replaces picking and navigation together, clearing stale routes and restoring furniture',()=>{
  const layout:RoomLayout={version:1,bounds:{minX:-3,maxX:4,minZ:-3,maxZ:4},spawn:[0,0,0],floors:[],assets:[{id:'conductor',type:'conductor',label:'指挥',position:[0,0,0],approach:[0,0,1],radius:1,rotation:0}],colliders:[{id:'Conductor lectern',min:[-.3,-.3],max:[.3,.3]}]};
  const world=Object.create(RoomWorld.prototype) as RoomWorld,party=new PartyScene(),scene=new THREE.Scene(),colorWarEffects=new ColorWarEffects(scene,layout);
  const internals={party,colorWarEffects,baseLayout:layout,layout,layoutSignature:'',scene,targets:[],path:[[1,0,1]],moveTrail:[[1,0,1]],pending:layout.assets[0],selected:layout.assets[0],marker:new THREE.Mesh(),options:{onSelect:()=>{}},people:new Map(),pressedKeys:new Map(),pianoNodes:new Map()};
  Object.assign(world,internals);
  const snapshot:RoomState={roomId:'r',players:{},occupancy:{},notes:{},conductor:{ownerId:null,bpm:90,playing:false,startAt:0,beats:4,gesture:'beat',gestureAt:0},serverTime:0,minigame:game()};
  world.setState(snapshot,'visitor');
  const applied=world as unknown as typeof internals;
  assert.equal(applied.layout.assets.some(a=>a.id==='conductor'),false);
  assert.equal(applied.targets.length,2);assert.deepEqual(applied.path,[]);assert.equal(applied.pending,null);assert.equal(applied.selected,null);
  assert.equal(canStand(applied.layout,0,0),true);assert.equal(canStand(applied.layout,1.3,1.75),false);
  world.setState({...snapshot,minigame:game('finished')},'visitor');
  assert.equal(applied.layout,layout);assert.equal(applied.targets.length,1);assert.equal(canStand(applied.layout,0,0),false);
  party.dispose();colorWarEffects.dispose();
});

test('personal relocation version preserves other players routes and corrects only the relocated local player',()=>{
  const world=Object.create(RoomWorld.prototype) as RoomWorld;
  const player:Player={id:'a',name:'A',avatar:DEFAULT_AVATAR,position:[1.3,0,2.45],yaw:1,mode:'walk',assetId:null,mic:false,emote:null,emoteUntil:0,pose:null,poseAt:0,chat:null};
  const other:Player={...player,id:'b',position:[2,0,0]};
  const state:RoomState={roomId:'r',players:{a:player,b:other},occupancy:{},notes:{},conductor:{ownerId:null,bpm:90,playing:false,startAt:0,beats:4,gesture:'beat',gestureAt:0},serverTime:0,minigame:game()};
  const layout:RoomLayout={version:1,bounds:{minX:-3,maxX:4,minZ:-3,maxZ:4},spawn:[0,0,0],assets:[{id:"conductor",type:"conductor",label:"指挥",position:[0,0,0],approach:[0,0,1],radius:1,rotation:0}],colliders:[],floors:[]};
  const party=new PartyScene(),local=new THREE.Vector3(...player.position),scene=new THREE.Scene(),colorWarEffects=new ColorWarEffects(scene,layout);
  const person={signature:JSON.stringify(DEFAULT_AVATAR),rig:{group:new THREE.Group()},label:{classList:{toggle:()=>{}}},nameLabel:{textContent:''},badge:{hidden:true,textContent:'',dataset:{}},bubble:{hidden:true},target:new THREE.Vector3(),last:new THREE.Vector3(),mode:'walk'};
  Object.assign(world,{party,colorWarEffects,baseLayout:layout,layout,layoutSignature:'',scene,targets:[],people:new Map([['a',person],['b',{...person,nameLabel:{textContent:''},badge:{hidden:true,textContent:'',dataset:{}},rig:{group:new THREE.Group()},target:new THREE.Vector3(),last:new THREE.Vector3()}]]),pressedKeys:new Map(),pianoNodes:new Map(),local,marker:new THREE.Mesh(),options:{onSelect:()=>{}},moveTrail:[],path:[]});
  world.setState(state,'a');local.x+=.2;
  const route=[[1.3,0,2.28]],pending=state.minigame!.chairs[0];Object.assign(world,{path:route,pending});
  const next:RoomState={...state,players:{...state.players,b:{...other,position:[2.1,0,0],positionVersion:1}},minigame:{...game(),teleportVersion:2}};
  world.setState(next,'a');
  const movement=world as unknown as {path:unknown[];pending:unknown};
  assert.equal(movement.path,route,'another person taking a seat must not cancel my approach');
  assert.equal(movement.pending,pending);assert.ok(Math.abs(local.x-1.5)<1e-9);
  const relocated:RoomState={...next,players:{...next.players,a:{...player,position:[1.35,0,2.45],positionVersion:1}}};world.setState(relocated,'a');
  assert.deepEqual(local.toArray(),[1.35,0,2.45]);assert.deepEqual(movement.path,[]);assert.equal(movement.pending,null);
  const restored:RoomState={...relocated,minigame:game('finished'),players:{...relocated.players,a:{...relocated.players.a,position:[1.4,0,2.45],positionVersion:2}}};world.setState(restored,'a');
  assert.deepEqual(local.toArray(),[1.4,0,2.45],'furniture restoration must apply even a small forced relocation');
  const champion:RoomState={...restored,minigame:{...game('finished'),winnerId:'a'}};world.setState(champion,'a');
  assert.equal(person.badge.textContent,'🏆 冠军');
  const paintLobby:RoomState={...champion,colorWar:{phase:'lobby',hostId:'a',round:0,startsAt:0,endsAt:0,members:{a:{team:'S',ready:false,score:0,nextThrowAt:0,scatterUntil:0,immuneUntil:0}},scores:{S:0,A:0,T:0,B:0,P:0},projectiles:[],splashes:[],event:null,winners:[],finishReason:null}};
  world.setState(paintLobby,'a');
  assert.equal(person.badge.hidden,true,'a previous chairs champion badge must not cover the next game');
  assert.equal(person.nameLabel.textContent,'[S] A');
  world.setState({...paintLobby,minigame:game('music',3),colorWar:{...paintLobby.colorWar!,phase:'finished'}},'a');
  assert.equal(person.nameLabel.textContent,'A','old paint team letters must not follow players into chairs');
  party.dispose();colorWarEffects.dispose();
});

test('each participant round opens a clear arena view once and preserves later camera adjustments',()=>{
  const world=Object.create(RoomWorld.prototype) as RoomWorld,party=new PartyScene();
  const layout:RoomLayout={version:1,bounds:{minX:-6.6,maxX:6.6,minZ:-5.4,maxZ:6},spawn:[0,0,0],assets:[{id:'conductor',type:'conductor',label:'指挥',position:[0,0,0],approach:[0,0,1],radius:1,rotation:0}],colliders:[],floors:[]};
  const state:RoomState={roomId:'r',players:{},occupancy:{},notes:{},conductor:{ownerId:null,bpm:90,playing:false,startAt:0,beats:4,gesture:'beat',gestureAt:0},serverTime:0,minigame:game('lobby')};
  const scene=new THREE.Scene(),colorWarEffects=new ColorWarEffects(scene,layout);
  Object.assign(world,{party,colorWarEffects,baseLayout:layout,layout,layoutSignature:'',scene,targets:[],people:new Map(),pressedKeys:new Map(),marker:new THREE.Mesh(),options:{onSelect:()=>{}},cameraYaw:0,pitch:.35,distance:3.8});
  const camera=world as unknown as {cameraYaw:number;pitch:number;distance:number};
  world.setState(state,'a');assert.equal(camera.cameraYaw,0);
  world.setState({...state,minigame:game('countdown')},'a');
  assert.deepEqual([camera.cameraYaw,camera.pitch,camera.distance],[-Math.PI/2,.6,3.4]);
  Object.assign(world,{cameraYaw:.4,pitch:.7,distance:4.2});
  world.setState({...state,minigame:game('music')},'a');
  world.setState({...state,minigame:game('scramble')},'a');
  assert.deepEqual([camera.cameraYaw,camera.pitch,camera.distance],[.4,.7,4.2]);
  world.setState({...state,minigame:game('music',2)},'a');
  assert.deepEqual([camera.cameraYaw,camera.pitch,camera.distance],[-Math.PI/2,.6,3.4]);
  Object.assign(world,{cameraYaw:.4,pitch:.7,distance:4.2});
  world.setState({...state,minigame:game('finished',2)},'a');
  world.setState({...state,minigame:{...game('music',3),alive:['b','c'],eliminated:['a']}},'a');
  assert.deepEqual([camera.cameraYaw,camera.pitch,camera.distance],[.4,.7,4.2]);
  party.dispose();colorWarEffects.dispose();
});
