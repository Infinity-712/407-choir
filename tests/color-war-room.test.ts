import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomController } from '../server/room.ts';
import type { RoomLayout } from '../shared/protocol.ts';

const layout:RoomLayout={version:1,bounds:{minX:-8,maxX:8,minZ:-8,maxZ:8},spawn:[0,0,0],floors:[],colliders:[],assets:[
  {id:'seat',label:'奖励椅',type:'chair',position:[0,.45,.8],approach:[0,0,.2],radius:1.5,rotation:0},
  {id:'piano',label:'钢琴',type:'piano',position:[.8,.5,0],approach:[.4,0,0],radius:1.5,rotation:0},
]};
function setup(random=()=>0){
  let now=1000;
  const rooms=new RoomController(layout,{now:()=>now,random});
  const join=(id:string,roomId='paint')=>rooms.join(id,{roomId,name:id});
  const cmd=(id:string,event:string,payload:Record<string,unknown>={})=>rooms.command(id,'color-war:'+event,payload);
  const game=()=>rooms.getState('paint')!.colorWar!;
  const start=()=>{join('a');join('b');assert.equal(cmd('a','join',{team:'S'}).ok,true);assert.equal(cmd('b','join',{team:'A'}).ok,true);cmd('a','ready',{ready:true});cmd('b','ready',{ready:true});assert.equal(cmd('a','start').ok,true);now+=3000;rooms.flushStates(()=>{});assert.equal(game().phase,'playing');};
  return {rooms,join,cmd,game,start,advance:(ms:number)=>{now+=ms;}};
}

test('room bridges color-war commands, isolates spectators and clones game snapshots',()=>{
  const h=setup();h.start();h.join('watcher');h.join('outsider','other');
  assert.equal(h.rooms.getState('other')!.colorWar,undefined);
  assert.equal(h.cmd('watcher','throw',{direction:[0,0,1],ownerId:'a',score:999}).ok,false);
  assert.equal(h.cmd('outsider','throw',{direction:[0,0,1]}).ok,false);
  assert.equal(h.cmd('a','throw',{direction:[0,0,1]}).ok,true);
  const snapshot=h.game();snapshot.scores.S=9000;snapshot.members.a.score=9000;
  assert.equal(h.game().scores.S,0);assert.equal(h.game().members.a.score,0);
  assert.equal(Object.keys(h.game().members).length,2);
});

test('only a successful real seat claim awards the one-shot chair event',()=>{
  const h=setup();h.start();h.advance(8000);const event=h.game().event!;
  assert.equal(event.kind,'chair');assert.equal(event.assetId,'seat');
  assert.equal(h.rooms.command('a','claim',{assetId:'missing'}).ok,false);assert.equal(h.game().scores.S,0);
  assert.equal(h.rooms.command('a','claim',{assetId:'seat'}).ok,true);assert.equal(h.game().scores.S,20);
  assert.equal(h.rooms.command('a','release',{}).ok,true);
  assert.equal(h.rooms.command('a','claim',{assetId:'seat'}).ok,true);assert.equal(h.game().scores.S,20);
});

test('validated piano key edges solve melody; held repeats, nonowners and clear cannot farm it',()=>{
  const h=setup(()=>.99);h.start();h.advance(8000);const event=h.game().event!;
  assert.equal(event.kind,'melody');const melody=event.melody;
  assert.ok(melody.length>=4&&melody.every(n=>n>=60&&n<=71));
  assert.equal(h.rooms.command('b','piano',{kind:'on',midi:melody[0]}).ok,false);
  assert.equal(h.rooms.command('a','claim',{assetId:'piano'}).ok,true);
  const note=(kind:string,midi:number)=>h.rooms.command('a','piano',{kind,midi});
  note('on',melody[0]);const progress=h.game().event!.progress.a;
  for(let i=0;i<6;i++)note('on',melody[0]);assert.equal(h.game().event!.progress.a,progress);
  h.rooms.command('a','piano',{kind:'clear'});assert.equal(h.game().event!.progress.a??0,0);
  for(const midi of melody){assert.equal(note('on',midi).ok,true);note('off',midi);h.advance(120);}
  assert.equal(h.game().scores.S,15);assert.ok(h.game().members.a.scatterUntil>h.rooms.getState('paint')!.serverTime);
  for(const midi of melody){note('on',midi);note('off',midi);}
  assert.equal(h.game().scores.S,15);
});

test('idle rounds finish on room flush and late interaction cannot earn points',()=>{
  const h=setup();h.start();h.advance(180000);
  const emitted:string[]=[];h.rooms.flushStates(id=>emitted.push(id));
  assert.deepEqual(emitted,['paint']);assert.equal(h.game().phase,'finished');
  assert.equal(h.cmd('a','throw',{direction:[0,0,1]}).ok,false);
  h.rooms.command('a','claim',{assetId:'seat'});assert.equal(h.game().scores.S,0);
  assert.deepEqual(h.game().projectiles,[]);assert.equal(h.game().event,null);
});

test('disconnect ends an unsupported match and the next host can reset without moving survivors',()=>{
  const h=setup();h.start();h.rooms.command('b','claim',{assetId:'seat'});const before=h.rooms.getState('paint')!.players.b;
  h.rooms.disconnect('a');assert.equal(h.game().hostId,'b');assert.equal(h.game().phase,'finished');
  assert.equal(h.game().members.a,undefined);assert.equal(h.cmd('b','reset').ok,true);
  const after=h.rooms.getState('paint')!.players.b;assert.equal(after.mode,before.mode);assert.deepEqual(after.position,before.position);
  assert.equal(h.game().phase,'lobby');assert.equal(h.game().members.b.ready,false);
});
