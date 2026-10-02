import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomController } from '../server/room.ts';
import { DEFAULT_AVATAR, type RoomLayout, type Vec3 } from '../shared/protocol.ts';
import { getMinigameLayout } from '../shared/minigames.ts';
import { canStand, findPath } from '../shared/movement.ts';

const layout:RoomLayout={version:1,bounds:{minX:-8,maxX:8,minZ:-8,maxZ:8},spawn:[1.3,0,2.45],floors:[],colliders:[{id:'Conductor lectern',min:[1,-.2],max:[1.6,.2]}],assets:[
  {id:'chair',type:'chair',label:'chair',position:[1.3,.5,2.5],approach:[1.3,0,2.45],rotation:0,radius:2},
  {id:'conductor',type:'conductor',label:'conductor',position:[1.3,0,0],approach:[1.3,0,.5],rotation:0,radius:3},
]};
function setup(random=0){
  let time=1000;
  const rooms=new RoomController(layout,{now:()=>time,random:()=>random});
  const state=(room='407')=>rooms.getState(room)!;
  const game=()=>state().minigame!;
  const action=(id:string,action:string,extra:Record<string,unknown>={})=>rooms.command(id,'minigame',{action,...extra});
  const advance=(ms:number)=>{time+=ms;rooms.flushStates(()=>{});};
  const join=(id:string,room='407')=>rooms.join(id,{roomId:room,name:id,avatar:DEFAULT_AVATAR});
  const register=(ids=['a','b','c'])=>{for(const id of ids){assert.equal(join(id).ok,true);assert.equal(action(id,'join').ok,true);}};
  const move=(id:string,p:Vec3,yaw=0)=>rooms.command(id,'move',{position:p,yaw});
  const walkTo=(id:string,p:Vec3)=>{const path=findPath(getMinigameLayout(layout,game()),state().players[id].position,p);assert.ok(path.length);for(const point of path){advance(100);assert.equal(move(id,point).ok,true);}};
  const music=()=>{assert.equal(action('a','start').ok,true);advance(3000);assert.equal(game().phase,'music');};
  const qualify=(ids=['a','b','c'])=>{advance(8000);for(let i=0;i<2;i++){advance(400);for(const id of ids){const p=state().players[id].position;const dx=p[0]-1.3,dz=p[2]-1,len=Math.hypot(dx,dz);const direction=i===0?1:-1;assert.equal(move(id,[p[0]+direction*.5*dx/len,0,p[2]+direction*.5*dz/len]).ok,true);}}advance(200);assert.equal(game().phase,'scramble');};
  const claim=(id:string,index:number,legacy=false)=>{const g=game(),chair=g.chairs[index];return rooms.command(id,legacy?'claim':'minigame',{action:'claim',assetId:chair.id,gameId:g.gameId,round:g.round});};
  return {rooms,state,game,action,advance,join,register,move,walkTo,music,qualify,claim};
}

test('registration enforces capacity, host authority and independent rooms',()=>{
  const s=setup();s.register(['a','b']);assert.equal(s.action('a','start').ok,false);s.register(['c','d','e','f']);s.join('g');assert.equal(s.action('g','join').ok,false);
  assert.equal(s.action('b','start').ok,false);assert.equal(s.action('a','join').ok,true);assert.equal(s.game().participants.length,6);
  s.join('other','other');s.action('other','join');assert.deepEqual(s.state('other').minigame!.participants,['other']);
  s.action('a','leave');assert.equal(s.game().hostId,'b');assert.equal(s.game().participants.length,5);
});

test('start clears old seats, requires empty conductor and keeps random music deadline private',()=>{
  const s=setup(1);s.register();assert.equal(s.rooms.command('b','claim',{assetId:'conductor'}).ok,true);assert.equal(s.action('a','start').ok,false);
  s.rooms.command('b','release',{});s.rooms.command('a','claim',{assetId:'chair'});assert.equal(s.action('a','start').ok,true);
  assert.equal(s.state().occupancy.chair,undefined);assert.equal(s.state().players.a.mode,'walk');assert.equal(s.game().chairs.length,2);assert.ok(s.game().teleportVersion>0);
  assert.equal(s.rooms.command('a','claim',{assetId:'chair'}).ok,false);s.advance(3000);assert.equal(s.game().phaseEndsAt,null);
  const snapshot=JSON.stringify(s.state());assert.equal(snapshot.includes('stopAt'),false);s.advance(13999);assert.equal(s.game().phase,'music');s.advance(1);assert.equal(s.game().phase,'scramble');
});

test('rotation, old movement and single-time path batches cannot qualify; valid travel freezes at stop',()=>{
  const s=setup();s.register();s.music();const p=s.state().players.a.position;s.advance(8000);s.move('a',p,1);s.advance(1000);
  assert.equal(s.game().movement.a.eligible,false);assert.equal(s.claim('a',0).ok,false);
  const t=setup();t.register();t.music();t.qualify();assert.equal(t.game().movement.a.eligible,true);const frozen=t.game().movement.a.distance;
  t.advance(4500);assert.equal(t.game().movement.a.distance,frozen);
  const u=setup();u.register();u.music();u.advance(8000);const q=u.state().players.a.position;
  assert.equal(u.rooms.command('a','move',{position:q,yaw:0,via:[[q[0],0,q[2]+.5]]}).ok,true);u.advance(1000);assert.equal(u.game().movement.a.eligible,false);
  const v=setup();v.register();v.music();for(let i=0;i<2;i++){v.advance(400);const q=v.state().players.a.position;v.move('a',[q[0],0,q[2]+(i===0?.5:-.5)]);}v.advance(8200);assert.equal(v.game().movement.a.eligible,false);
});

test('seat validator handles spectators, distance, races, duplicates and old round requests',()=>{
  const s=setup();s.register();s.join('watch');s.music();s.qualify();assert.equal(s.claim('watch',0).ok,false);assert.equal(s.claim('b',0).ok,false);
  const old={action:'claim',assetId:s.game().chairs[0].id,gameId:s.game().gameId,round:1};s.walkTo('a',s.game().chairs[0].approach);assert.equal(s.claim('a',0,true).ok,true);assert.equal(s.claim('a',0).ok,true);
  s.walkTo('b',s.game().chairs[0].approach);assert.equal(s.claim('b',0).ok,false);s.walkTo('b',s.game().chairs[1].approach);assert.equal(s.claim('b',1).ok,true);
  assert.equal(s.game().phase,'roundEnd');assert.equal(s.game().lastEliminatedId,'c');assert.equal(s.state().players.c.mode,'walk');s.advance(3000);assert.equal(s.game().round,2);
  assert.equal(s.rooms.command('a','minigame',old).ok,false);assert.equal(Object.keys(s.game().seats).length,0);
});

test('timeout eliminates least qualified, cancels empty final and restores occupied furniture safely',()=>{
  const s=setup();s.register();s.join('watch');s.music();s.advance(9000);s.walkTo('watch',[1.3,0,0]);assert.equal(canStand(layout,1.3,0),false);
  s.advance(12000);assert.equal(s.game().phase,'roundEnd');assert.equal(s.game().lastEliminatedId,'a');assert.ok(s.game().message);s.advance(3000);s.advance(9000);s.advance(12000);
  assert.equal(s.game().phase,'finished');assert.equal(s.game().winnerId,null);assert.equal(s.game().chairs.length,0);assert.equal(canStand(layout,...[s.state().players.watch.position[0],s.state().players.watch.position[2]] as [number,number]),true);
});

test('withdrawal victory, connected nomination, reset and repeated room join clean all seats',()=>{
  const s=setup();s.register();s.join('watch');s.music();s.rooms.disconnect('b');assert.equal(s.game().hostId,'a');s.action('c','leave');assert.equal(s.game().winnerId,'a');
  assert.equal(s.action('watch','nominate',{playerId:'c'}).ok,false);assert.equal(s.action('a','nominate',{playerId:'watch'}).ok,false);assert.equal(s.action('a','nominate',{playerId:'b'}).ok,false);
  assert.equal(s.action('a','nominate',{playerId:'c'}).ok,true);assert.equal(s.game().singerId,'c');assert.equal(s.state().players.c.mic,false);assert.equal(s.action('a','reset').ok,true);assert.deepEqual(s.game().participants,[]);
  s.action('a','join');s.action('c','join');s.join('d');s.action('d','join');s.action('a','start');assert.equal(s.join('a','other').ok,true);assert.equal(s.game().alive.includes('a'),false);assert.equal(s.game().hostId,'c');
});

test('a final seat earns a champion, clears game occupancy and preserves idempotence until reset',()=>{
  const s=setup();s.register();s.music();s.qualify();s.walkTo('a',s.game().chairs[0].approach);assert.equal(s.claim('a',0).ok,true);
  const version=s.game().teleportVersion;assert.equal(s.rooms.command('a','release',{}).ok,false);assert.equal(Object.values(s.game().seats).includes('a'),true);
  s.walkTo('b',s.game().chairs[1].approach);s.claim('b',1);s.advance(3000);s.qualify(['a','b']);s.walkTo('a',s.game().chairs[0].approach);
  const request={action:'claim',assetId:s.game().chairs[0].id,gameId:s.game().gameId,round:2};assert.equal(s.rooms.command('a','minigame',request).ok,true);
  assert.equal(s.game().winnerId,'a');assert.equal(s.game().phase,'finished');assert.equal(s.game().chairs.length,0);assert.deepEqual(s.game().seats,{});
  assert.equal(Object.keys(s.state().occupancy).some(id=>id.startsWith('game-chair-')),false);assert.equal(s.state().players.a.mode,'walk');assert.ok(s.game().teleportVersion>version);
  assert.equal(s.rooms.command('a','minigame',request).ok,true);s.action('a','reset');assert.equal(s.rooms.command('a','minigame',request).ok,false);
});

test('travel rejected for speed or dynamic furniture never grants movement credit',()=>{
  const s=setup();s.register();s.music();s.advance(8000);const p=s.state().players.a.position;
  assert.equal(s.move('a',[p[0]+2,0,p[2]]).ok,false);assert.equal(s.move('a',s.game().chairs[0].position).ok,false);s.advance(1000);
  assert.deepEqual(s.game().movement.a,{distance:0,eligible:false});assert.equal(s.claim('a',0,true).ok,false);
});

test('walking a small circle cannot substitute distance for the required position span',()=>{
  const s=setup();s.register();s.music();s.advance(7600);const p=s.state().players.a.position;
  for(const [dx,dz] of [[.195,0],[0,.195],[-.195,0],[0,-.195],[.195,0]]){s.advance(250);assert.equal(s.move('a',[p[0]+dx,0,p[2]+dz]).ok,true);}s.advance(150);
  assert.equal(s.game().phase,'scramble');assert.ok(s.game().movement.a.distance>.8);assert.equal(s.game().movement.a.eligible,false);
});

test('only the relocated player changes position version; walking and other seat claims preserve it',()=>{
  const s=setup();s.register();s.join('watch');
  for(const player of Object.values(s.state().players))assert.equal(player.positionVersion,0);
  assert.equal(s.rooms.command('a','claim',{assetId:'chair'}).ok,true);assert.equal(s.state().players.a.positionVersion,1);assert.equal(s.state().players.b.positionVersion,0);
  s.rooms.command('a','release',{});assert.equal(s.state().players.a.positionVersion,2);assert.equal(s.state().players.watch.positionVersion,0);
  s.music();s.qualify();s.walkTo('a',s.game().chairs[0].approach);
  const before=s.state().players,globalVersion=s.game().teleportVersion;assert.equal(s.claim('a',0).ok,true);const after=s.state().players;
  assert.equal(after.a.positionVersion,before.a.positionVersion!+1);assert.equal(after.b.positionVersion,before.b.positionVersion);assert.equal(after.c.positionVersion,before.c.positionVersion);assert.equal(after.watch.positionVersion,before.watch.positionVersion);assert.ok(s.game().teleportVersion>globalVersion);
  const current=after.b.positionVersion;s.advance(200);const p=s.state().players.b.position;assert.equal(s.move('b',[p[0],0,p[2]-.1]).ok,true);assert.equal(s.state().players.b.positionVersion,current);
});

test('one random draw chooses each round drum variant while retaining private 9–14 second stops',()=>{
  for(const [random,variant,duration] of [[0,0,9000],[.5,1,11500],[1,2,14000]]){
    const s=setup(random);s.register();s.music();assert.equal(s.game().musicVariant,variant);assert.equal(s.game().phaseEndsAt,null);
    s.advance(duration-1);assert.equal(s.game().phase,'music');s.advance(1);assert.equal(s.game().phase,'scramble');
  }
});

test('spectators can register again after every original participant disconnects',()=>{
  const s=setup();s.register();s.join('watch');s.music();s.rooms.disconnect('a');s.rooms.disconnect('b');
  assert.equal(s.game().phase,'finished');assert.equal(s.game().winnerId,'c');assert.equal(s.action('watch','reset').ok,false);assert.equal(s.action('watch','join').ok,false);
  const version=s.game().teleportVersion;s.rooms.disconnect('c');
  assert.equal(s.game().phase,'lobby');assert.equal(s.game().teleportVersion,version);assert.deepEqual(s.game().participants,[]);assert.equal(s.game().winnerId,null);
  assert.equal(s.action('watch','join').ok,true);assert.equal(s.game().hostId,'watch');assert.deepEqual(s.game().participants,['watch']);
});
