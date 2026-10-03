import test from 'node:test';
import assert from 'node:assert/strict';
import { ColorWarGame } from '../server/color-war.ts';
import { DEFAULT_AVATAR, type Player, type RoomLayout, type Vec3 } from '../shared/protocol.ts';

const layout:RoomLayout={version:1,bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20},spawn:[0,0,0],floors:[],colliders:[],assets:[
  {id:'chair',type:'chair',label:'chair',position:[0,.5,3],approach:[0,0,2.5],rotation:0,radius:1},
  {id:'piano',type:'piano',label:'piano',position:[-3,.5,0],approach:[-2.5,0,0],rotation:0,radius:1},
]};
function setup(custom=layout,random=()=>0){
  let now=1000;const game=new ColorWarGame(custom,{now:()=>now,random});
  const context={players:new Map<string,Player>(),occupancy:new Map<string,string>()};
  const add=(id:string,position:Vec3=[0,0,0])=>{const p:Player={id,name:id,avatar:DEFAULT_AVATAR,position,yaw:0,mode:'walk',assetId:null,mic:false,emote:null,emoteUntil:0,pose:null,poseAt:0,chat:null};context.players.set(id,p);return p;};
  const cmd=(id:string,event:string,payload:Record<string,unknown>={})=>game.command(id,`color-war:${event}`,payload,context);
  const advance=(ms:number)=>{now+=ms;game.tick(context);};
  const start=()=>{add('a');add('b',[0,0,3]);assert.equal(cmd('a','join',{team:'S'}).ok,true);assert.equal(cmd('b','join',{team:'A'}).ok,true);cmd('a','ready',{ready:true});cmd('b','ready',{ready:true});assert.equal(cmd('a','start').ok,true);advance(3000);};
  return {game,context,add,cmd,advance,start};
}
test('game lobby validates teams, capacity, ready, host and real membership',()=>{
  const s=setup();assert.equal(s.game.snapshot(),undefined);assert.equal(s.cmd('ghost','join',{team:'S'}).ok,false);
  for(let i=0;i<5;i++){s.add(`s${i}`);assert.equal(s.cmd(`s${i}`,'join',{team:'S'}).ok,i<4);}
  assert.equal(s.cmd('s0','start').ok,false);assert.equal(s.cmd('s0','join',{team:'__proto__'}).ok,false);
  s.add('a');s.cmd('a','join',{team:'A'});assert.equal(s.cmd('a','start').ok,false);
  for(const id of ['s0','s1','s2','s3','a'])s.cmd(id,'ready',{ready:true});
  assert.equal(s.cmd('s0','start').ok,true);assert.equal(s.game.snapshot()!.phase,'countdown');
  assert.equal(s.cmd('s4','join',{team:'T'}).ok,false);s.advance(3000);assert.equal(s.game.snapshot()!.phase,'playing');
});
test('server projectiles score enemy and friendly hits, exclude spectator, and enforce cooldown',()=>{
  const s=setup();s.start();s.add('spectator',[0,0,1]);
  assert.equal(s.cmd('spectator','throw',{direction:[0,0,1]}).ok,false);
  assert.equal(s.cmd('a','throw',{direction:[0,0,1],ownerId:'b',score:1000}).ok,true);
  assert.equal(s.cmd('a','throw',{direction:[0,0,1]}).ok,false);s.advance(300);
  assert.equal(s.game.snapshot()!.scores.S,10);assert.equal(s.game.snapshot()!.members.b.immuneUntil>0,true);
  const q=setup();q.start();q.add('c',[0,0,1.5]);q.context.players.get('b')!.position=[4,0,4];
  // Join allies before starting a new round.
  q.cmd('a','stop');q.cmd('a','reset');q.cmd('c','join',{team:'S'});
  for(const id of ['a','b','c'])q.cmd(id,'ready',{ready:true});q.cmd('a','start');q.advance(3000);
  q.cmd('a','throw',{direction:[0,0,1]});q.advance(250);assert.equal(q.game.snapshot()!.scores.S,-8);
});
test('malformed directions and piano/conductor shots are rejected',()=>{
  const s=setup();s.start();for(const direction of [null,[],[0,0,0],[NaN,0,1],[0,Infinity,1],['0',0,1]])assert.equal(s.cmd('a','throw',{direction}).ok,false);
  s.context.players.get('a')!.mode='piano';assert.equal(s.cmd('a','throw',{direction:[0,0,1]}).ok,false);
});
test('swept collision stops at a wall and ignores furniture below flight',()=>{
  const wall=setup({...layout,colliders:[{min:[-1,1],max:[1,1.1],minY:0,maxY:3}]});wall.start();wall.cmd('a','throw',{direction:[0,0,1]});wall.advance(300);assert.equal(wall.game.snapshot()!.scores.S,0);assert.equal(wall.game.snapshot()!.projectiles.length,0);
  const low=setup({...layout,colliders:[{min:[-1,1],max:[1,1.1],minY:0,maxY:.2}]});low.start();low.cmd('a','throw',{direction:[0,0,1]});low.advance(300);assert.equal(low.game.snapshot()!.scores.S,10);
});
test('chair event rewards once, clocks end exactly, reset removes transient data',()=>{
  const s=setup();s.start();s.advance(8000);const e=s.game.snapshot()!.event!;assert.equal(e.kind,'chair');
  const p=s.context.players.get('a')!;p.mode='sit';p.assetId='chair';s.context.occupancy.set('chair','a');
  assert.equal(s.game.onClaim(p,layout.assets[0],s.context),true);assert.equal(s.game.onClaim(p,layout.assets[0],s.context),false);assert.equal(s.game.snapshot()!.scores.S,20);
  s.advance(172000);assert.equal(s.game.snapshot()!.phase,'finished');assert.deepEqual(s.game.snapshot()!.winners,['S']);assert.equal(s.cmd('a','throw',{direction:[0,0,1]}).ok,false);
  assert.equal(s.cmd('a','reset').ok,true);const snap=s.game.snapshot()!;assert.equal(snap.phase,'lobby');assert.equal(snap.scores.S,0);assert.equal(snap.members.a.ready,false);assert.equal(snap.event,null);
});
test('melody sequence has gap/reset, first completion rewards scatter, release clears progress',()=>{
  const s=setup(layout,()=>.9);s.start();s.advance(8000);assert.equal(s.game.snapshot()!.event!.kind,'melody');
  const p=s.context.players.get('a')!;p.mode='piano';p.assetId='piano';s.context.occupancy.set('piano','a');const melody=s.game.snapshot()!.event!.melody;
  s.game.onPiano(p,{kind:'on',midi:melody[0]},s.context);s.advance(3001);assert.equal(s.game.snapshot()!.event!.progress.a??0,0);
  s.game.onPiano(p,{kind:'on',midi:melody[0]},s.context);s.game.onRelease('a');assert.equal(s.game.snapshot()!.event!.progress.a??0,0);
  for(const midi of melody)s.game.onPiano(p,{kind:'on',midi},s.context);
  assert.equal(s.game.snapshot()!.scores.S,15);assert.equal(s.game.snapshot()!.event,null);assert.ok(s.game.snapshot()!.members.a.scatterUntil>0);
  p.mode='walk';p.assetId=null;s.cmd('a','throw',{direction:[1,.1,0]});assert.equal(s.game.snapshot()!.projectiles.length,3);
  s.advance(12001);assert.equal(s.game.snapshot()!.members.a.scatterUntil,0);
});
test('host migration, opposing-team departure, and snapshots are isolated',()=>{
  const s=setup();s.start();const snap=s.game.snapshot()!;snap.scores.S=100;assert.equal(s.game.snapshot()!.scores.S,0);
  s.game.removePlayer('a',s.context);assert.equal(s.game.snapshot()!.hostId,'b');assert.equal(s.game.snapshot()!.phase,'finished');assert.equal(s.game.snapshot()!.projectiles.length,0);
  s.game.removePlayer('b',s.context);assert.equal(s.game.snapshot(),undefined);
});
test('twenty participants fit five teams and changing teams clears readiness',()=>{
  const s=setup();for(const t of ['S','A','T','B','P'])for(let n=0;n<4;n++){const id=`${t}${n}`;s.add(id);assert.equal(s.cmd(id,'join',{team:t}).ok,true);}
  assert.equal(Object.keys(s.game.snapshot()!.members).length,20);s.add('overflow');assert.equal(s.cmd('overflow','join',{team:'A'}).ok,false);
  s.cmd('A0','leave');s.cmd('S0','ready',{ready:true});assert.equal(s.cmd('S0','join',{team:'A'}).ok,true);assert.equal(s.game.snapshot()!.members.S0.ready,false);
});
test('expired events cannot reward and spectators cannot consume chair or melody',()=>{
  const s=setup();s.start();s.advance(8000);const outsider=s.add('spectator');outsider.mode='sit';outsider.assetId='chair';s.context.occupancy.set('chair',outsider.id);
  assert.equal(s.game.onClaim(outsider,layout.assets[0],s.context),false);assert.ok(s.game.snapshot()!.event);
  s.advance(20000);const a=s.context.players.get('a')!;a.mode='sit';a.assetId='chair';s.context.occupancy.set('chair','a');assert.equal(s.game.onClaim(a,layout.assets[0],s.context),false);assert.equal(s.game.snapshot()!.scores.S,0);
  const m=setup(layout,()=>.99);m.start();m.advance(8000);const ghost=m.add('outsider');ghost.mode='piano';ghost.assetId='piano';m.context.occupancy.set('piano',ghost.id);
  for(const midi of m.game.snapshot()!.event!.melody)assert.equal(m.game.onPiano(ghost,{kind:'on',midi},m.context),false);assert.equal(m.game.snapshot()!.scores.S,0);
});
test('occupied chairs fall back to melody; missing assets skip event safely',()=>{
  const s=setup();s.start();s.context.occupancy.set('chair','spectator');s.advance(8000);assert.equal(s.game.snapshot()!.event!.kind,'melody');
  const empty=setup({...layout,assets:[]});empty.start();empty.advance(8000);assert.equal(empty.game.snapshot()!.event,null);
});

test('beginner melody events use five white keys within one octave and small intervals',()=>{
  const patterns=new Set<string>();
  for(let seed=0;seed<=10;seed++){
    const s=setup({...layout,assets:layout.assets.filter(a=>a.type==='piano')},()=>seed/10);s.start();s.advance(8000);
    const melody=s.game.snapshot()!.event!.melody;
    assert.equal(melody.length,5);assert.ok(melody.every(n=>[60,62,64,65,67,69,71].includes(n)));
    assert.ok(new Set(melody).size>=2,'challenge is a short tune rather than five copies of one note');
    assert.ok(melody.slice(1).every((n,i)=>Math.abs(n-melody[i])<=7));patterns.add(melody.join(','));
  }
  assert.ok(patterns.size>=3,'events offer varied simple tunes');
});
test('immunity prevents immediate repeat hits and expired effects disappear',()=>{
  const s=setup();s.start();s.cmd('a','throw',{direction:[0,0,1]});s.advance(300);assert.equal(s.game.snapshot()!.scores.S,10);
  s.advance(350);s.cmd('a','throw',{direction:[0,0,1]});s.advance(300);assert.equal(s.game.snapshot()!.scores.S,10);
  s.advance(350);s.cmd('a','throw',{direction:[0,0,1]});s.advance(300);assert.equal(s.game.snapshot()!.scores.S,20);
  s.advance(5000);assert.equal(s.game.snapshot()!.projectiles.length,0);assert.equal(s.game.snapshot()!.splashes.length,0);
});
test('polygon footprint collisions preserve empty corners and catch very thin obstacles',()=>{
  const thin=setup({...layout,colliders:[{min:[-1,1],max:[1,2],minY:0,maxY:3,footprint:[[-1,1],[1,1],[1,1.00001],[-1,1.00001]]}]});thin.start();thin.cmd('a','throw',{direction:[0,0,1]});thin.advance(300);assert.equal(thin.game.snapshot()!.scores.S,0);
  const corner=setup({...layout,colliders:[{min:[-1,1],max:[1,2],minY:0,maxY:3,footprint:[[-1,1],[-.5,1],[-1,2]]}]});corner.start();corner.cmd('a','throw',{direction:[0,0,1]});corner.advance(300);assert.equal(corner.game.snapshot()!.scores.S,10);
});
test('ending during countdown clears game resources without mutating ordinary player state',()=>{
  const s=setup();s.add('a');s.add('b');s.cmd('a','join',{team:'S'});s.cmd('b','join',{team:'A'});s.cmd('a','ready',{ready:true});s.cmd('b','ready',{ready:true});s.cmd('a','start');
  const a=s.context.players.get('a')!;a.mode='piano';a.assetId='piano';s.context.occupancy.set('piano','a');
  assert.equal(s.cmd('b','stop').ok,false);assert.equal(s.cmd('a','stop').ok,true);assert.equal(s.game.snapshot()!.phase,'finished');assert.equal(a.mode,'piano');assert.equal(s.context.occupancy.get('piano'),'a');
});
test('shots above the visible head or outside the visible body do not score',()=>{
  const high=setup();high.start();high.cmd('a','throw',{direction:[0,.1,1]});high.advance(300);
  assert.equal(high.game.snapshot()!.scores.S,0,'the balloon passes above the 1.16m rendered head');
  const wide=setup();wide.start();wide.context.players.get('b')!.position=[.29,0,3];wide.cmd('a','throw',{direction:[0,0,1]});wide.advance(300);
  assert.equal(wide.game.snapshot()!.scores.S,0,'a .6m wide rectangular target extends outside the face');
});
test('body and head remain hittable at rendered scale on the floor and raised platforms',()=>{
  for(const height of [0,.8])for(const slope of [-.14,0]){
    const s=setup({...layout,floors:height?[{min:[-5,-5],max:[5,5],height}]:[]});s.start();
    s.context.players.get('a')!.position=[0,height,0];s.context.players.get('b')!.position=[0,height,3];
    s.cmd('a','throw',{direction:[0,slope,1]});s.advance(300);assert.equal(s.game.snapshot()!.scores.S,10,`height ${height}, slope ${slope}`);
    const hit=s.game.snapshot()!.splashes.find(splash=>splash.targetId==='b')!;
    assert.ok(hit.position[1]<=height+1.16,'hit stays inside the visible vertical silhouette');
  }
});
test('seated launch and target use seat drop and forward offset at either platform height',()=>{
  for(const height of [0,.8]){
    const s=setup({...layout,floors:height?[{min:[-5,-5],max:[5,5],height}]:[]});s.start();
    for(const [id,z] of [['a',0],['b',3]] as const){const p=s.context.players.get(id)!;p.mode='sit';p.position=[0,height+.5,z];}
    s.cmd('a','throw',{direction:[0,0,1]});const ball=s.game.snapshot()!.projectiles[0];
    assert.ok(ball.position[1]<height+1.1,'seated chest launch is below the seated head');assert.ok(ball.position[2]>.1,'launch follows chair forward offset');
    s.advance(300);assert.equal(s.game.snapshot()!.scores.S,10);assert.ok(s.game.snapshot()!.splashes[0].position[1]<height+1.5);
  }
});
test('a crosswise balloon hits the rendered pianist face after its world-space forward shift',()=>{
  for(const yaw of [0,Math.PI/2]){
    const s=setup();s.start();const c=Math.cos(yaw),sin=Math.sin(yaw);
    const pianist=s.context.players.get('b')!;pianist.mode='piano';pianist.position=[0,.53,3];pianist.yaw=yaw;
    // The actual face is centered at local world z≈.321 after the .14m
    // RoomWorld shift and the scaled .35rad AvatarRig lean. z=.43 crosses it.
    s.context.players.get('a')!.position=[-c+.43*sin,.2,3+sin+.43*c];
    assert.equal(s.cmd('a','throw',{direction:[c,0,-sin]}).ok,true);s.advance(180);
    assert.equal(s.game.snapshot()!.scores.S,10,`piano facing ${yaw}`);
    assert.equal(s.game.snapshot()!.splashes[0].targetId,'b');
  }
});
