import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomController } from '../server/room.ts';
import { canStand, findPath, groundHeight } from '../shared/movement.ts';
import { GAME_CENTER, getMinigameLayout } from '../shared/minigames.ts';
import type { Ack, RoomLayout } from '../shared/protocol.ts';

const layout:RoomLayout={version:1,bounds:{minX:-8,maxX:8,minZ:-8,maxZ:8},spawn:[0,0,0],floors:[],colliders:[],assets:[]};
function setup(){
  let now=1000;
  const rooms=new RoomController(layout,{now:()=>now,random:()=>0});
  const join=(id:string,roomId='shared')=>rooms.join(id,{roomId,name:id});
  const chairs=(id:string,action:string,payload:Record<string,unknown>={})=>rooms.command(id,'minigame',{action,...payload});
  const paint=(id:string,action:string,payload:Record<string,unknown>={})=>rooms.command(id,'color-war:'+action,payload);
  const state=(roomId='shared')=>rooms.getState(roomId)!;
  const advance=(ms:number)=>{now+=ms;rooms.flushStates(()=>{});};
  return {rooms,join,chairs,paint,state,advance};
}
function succeeds(result:Ack){assert.equal(result.ok,true,result.error);}
function blocked(result:Ack){assert.equal(result.ok,false);assert.ok(result.error,'a rejected game command explains the occupied room');}

test('a musical chairs signup reserves its room before countdown, including against its own members',()=>{
  const h=setup();for(const id of ['a','b','c','watcher'])succeeds(h.join(id));
  succeeds(h.chairs('a','join'));
  blocked(h.paint('a','join',{team:'S'}));blocked(h.paint('watcher','join',{team:'A'}));
  assert.equal(h.state().colorWar,undefined);
  assert.deepEqual(h.state().minigame!.participants,['a']);
  for(const id of ['b','c'])succeeds(h.chairs(id,'join'));
  succeeds(h.chairs('a','start'));
  blocked(h.paint('watcher','join',{team:'S'}));
  h.advance(3000);assert.equal(h.state().minigame!.phase,'music');
  blocked(h.paint('a','join',{team:'S'}));
});

test('a color war signup reserves its room during lobby, countdown and play',()=>{
  const h=setup();for(const id of ['a','b','watcher'])succeeds(h.join(id));
  succeeds(h.paint('a','join',{team:'S'}));
  blocked(h.chairs('a','join'));blocked(h.chairs('watcher','join'));
  assert.deepEqual(h.state().minigame!.participants,[]);
  succeeds(h.paint('b','join',{team:'A'}));
  for(const id of ['a','b'])succeeds(h.paint(id,'ready',{ready:true}));
  succeeds(h.paint('a','start'));blocked(h.chairs('watcher','join'));
  h.advance(3000);assert.equal(h.state().colorWar!.phase,'playing');
  blocked(h.chairs('watcher','join'));
  assert.equal(h.state().minigame!.chairs.length,0);
});

test('finished chairs release the room and cannot reset over a new color war lobby',()=>{
  const h=setup();for(const id of ['a','b'])succeeds(h.join(id));
  succeeds(h.chairs('a','join'));succeeds(h.chairs('a','cancel'));
  assert.equal(h.state().minigame!.phase,'finished');
  succeeds(h.paint('b','join',{team:'A'}));
  const before=structuredClone(h.state().colorWar);
  blocked(h.chairs('a','reset'));blocked(h.chairs('a','join'));blocked(h.chairs('a','start'));
  assert.equal(h.state().minigame!.phase,'finished');
  assert.deepEqual(h.state().colorWar,before);
  succeeds(h.chairs('a','leave'));
  assert.deepEqual(h.state().colorWar,before,'leaving an old result never ends the new lobby');
  succeeds(h.paint('b','leave'));
  succeeds(h.chairs('b','join'));
});

test('finished color war releases the room and its stale reset cannot interrupt new chairs',()=>{
  const h=setup();for(const id of ['a','b','c'])succeeds(h.join(id));
  succeeds(h.paint('a','join',{team:'S'}));succeeds(h.paint('b','join',{team:'A'}));
  for(const id of ['a','b'])succeeds(h.paint(id,'ready',{ready:true}));
  succeeds(h.paint('a','start'));succeeds(h.paint('a','stop'));
  assert.equal(h.state().colorWar!.phase,'finished');
  for(const id of ['a','b','c'])succeeds(h.chairs(id,'join'));
  succeeds(h.chairs('a','start'));
  const gameId=h.state().minigame!.gameId;
  blocked(h.paint('a','reset'));blocked(h.paint('a','ready',{ready:true}));blocked(h.paint('a','start'));
  blocked(h.paint('a','throw',{direction:[0,0,1]}));
  assert.equal(h.state().colorWar!.phase,'finished');
  assert.equal(h.state().minigame!.gameId,gameId);
  assert.equal(h.state().minigame!.phase,'countdown');
  succeeds(h.paint('a','leave'));succeeds(h.paint('b','leave'));
  assert.equal(h.state().colorWar,undefined);
  assert.equal(h.state().minigame!.participants.length,3,'leaving an old paint result preserves current chairs participation');
});

test('a previous chairs champion cannot send new singing nominations during another game',()=>{
  const h=setup();for(const id of ['a','b','c','paint-host'])succeeds(h.join(id));
  for(const id of ['a','b','c'])succeeds(h.chairs(id,'join'));
  succeeds(h.chairs('a','start'));succeeds(h.chairs('b','leave'));succeeds(h.chairs('c','leave'));
  assert.equal(h.state().minigame!.winnerId,'a');
  succeeds(h.chairs('a','nominate',{playerId:'b'}));
  succeeds(h.paint('paint-host','join',{team:'S'}));
  blocked(h.chairs('a','nominate',{playerId:'c'}));
  assert.equal(h.state().minigame!.singerId,'b');
  succeeds(h.paint('paint-host','leave'));
  succeeds(h.chairs('a','nominate',{playerId:'c'}));
});

test('a cached successful game chair claim cannot bypass the next game through the ordinary claim event',()=>{
  const h=setup();for(const id of ['a','b','c']){succeeds(h.join(id));succeeds(h.chairs(id,'join'));}
  succeeds(h.chairs('a','start'));h.advance(3000);h.advance(8000);
  for(const direction of [1,-1]){
    h.advance(400);const p=h.state().players.a.position,dx=p[0]-GAME_CENTER[0],dz=p[2]-GAME_CENTER[2],length=Math.hypot(dx,dz);
    succeeds(h.rooms.command('a','move',{position:[p[0]+direction*.5*dx/length,0,p[2]+direction*.5*dz/length],yaw:0}));
  }
  h.advance(200);assert.equal(h.state().minigame!.phase,'scramble');assert.equal(h.state().minigame!.movement.a.eligible,true);
  const game=h.state().minigame!,chair=game.chairs[0];
  const request={assetId:chair.id,gameId:game.gameId,round:game.round};
  for(const position of findPath(getMinigameLayout(layout,game),h.state().players.a.position,chair.approach)){
    h.advance(100);succeeds(h.rooms.command('a','move',{position,yaw:chair.rotation}));
  }
  succeeds(h.rooms.command('a','claim',request));
  succeeds(h.chairs('a','cancel'));
  succeeds(h.rooms.command('a','claim',request)); // The old success is intentionally idempotent before another game starts.
  succeeds(h.paint('b','join',{team:'A'}));
  blocked(h.rooms.command('a','claim',request));
  assert.equal(h.state().occupancy[chair.id],undefined);
  assert.equal(h.state().players.a.mode,'walk');
});

test('the last lobby departure frees either game without requiring a host reset',()=>{
  const h=setup();for(const id of ['a','b'])succeeds(h.join(id));
  succeeds(h.chairs('a','join'));succeeds(h.chairs('b','join'));
  succeeds(h.chairs('a','leave'));blocked(h.paint('a','join',{team:'S'}));
  succeeds(h.chairs('b','leave'));succeeds(h.paint('a','join',{team:'S'}));
  succeeds(h.paint('b','join',{team:'A'}));
  succeeds(h.paint('a','leave'));blocked(h.chairs('a','join'));
  succeeds(h.paint('b','leave'));succeeds(h.chairs('a','join'));
});

test('disconnect and room changes free old reservations and cannot transfer them to a new room',()=>{
  const h=setup();for(const id of ['a','watcher'])succeeds(h.join(id));
  succeeds(h.chairs('a','join'));h.rooms.disconnect('a');
  succeeds(h.paint('watcher','join',{team:'S'}));
  succeeds(h.join('a'));blocked(h.chairs('a','join'));
  succeeds(h.join('watcher','other'));
  succeeds(h.chairs('a','join'));
  succeeds(h.paint('watcher','join',{team:'A'}));
  assert.deepEqual(h.state().minigame!.participants,['a']);
  assert.equal(h.state().colorWar,undefined);
  assert.equal(h.state('other').colorWar!.members.watcher.team,'A');
  h.rooms.disconnect('watcher');succeeds(h.join('newcomer','other'));
  succeeds(h.chairs('newcomer','join'));
});

test('separate rooms can run different games concurrently with independent clocks and teardown',()=>{
  const h=setup();for(const id of ['a','b','c']){succeeds(h.join(id));succeeds(h.chairs(id,'join'));}
  for(const [id,team] of [['red','S'],['blue','A']]){succeeds(h.join(id,'paint'));succeeds(h.paint(id,'join',{team}));succeeds(h.paint(id,'ready',{ready:true}));}
  succeeds(h.chairs('a','start'));succeeds(h.paint('red','start'));h.advance(3000);
  assert.equal(h.state().minigame!.phase,'music');assert.equal(h.state('paint').colorWar!.phase,'playing');
  assert.equal(h.state().colorWar,undefined);assert.deepEqual(h.state('paint').minigame!.participants,[]);
  succeeds(h.chairs('a','cancel'));succeeds(h.paint('red','throw',{direction:[1,.2,0]}));
  assert.equal(h.state('paint').colorWar!.phase,'playing');
});

test('the deployed room layout admits 20 distinct walkable arrivals and refuses the 21st',()=>{
  const realLayout=JSON.parse(readFileSync(new URL('../public/assets/interaction-layout.json',import.meta.url),'utf8')) as RoomLayout;
  const rooms=new RoomController(realLayout);
  for(let i=0;i<20;i++)succeeds(rooms.join('arrival-'+i,{roomId:'capacity',name:'Player '+i}));
  blocked(rooms.join('overflow',{roomId:'capacity',name:'Too many'}));
  const players=Object.values(rooms.getState('capacity')!.players);assert.equal(players.length,20);
  for(let i=0;i<players.length;i++){
    const [x,y,z]=players[i].position;
    assert.ok(canStand(realLayout,x,z),`arrival ${i} must be outside furniture and inside the actual room polygon`);
    assert.equal(y,groundHeight(realLayout,x,z));
    for(let j=0;j<i;j++)assert.ok(Math.hypot(x-players[j].position[0],z-players[j].position[2])>=.55,`arrivals ${i} and ${j} must not overlap`);
  }
  succeeds(rooms.join('overflow',{roomId:'other',name:'A different room'}));
});
