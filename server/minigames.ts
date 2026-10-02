import { randomUUID } from 'node:crypto';
import { createGameChairs, GAME_CENTER, GAME_COUNTDOWN_MS, GAME_MAX_PLAYERS, GAME_MIN_DISTANCE, GAME_MIN_PLAYERS, GAME_MIN_SPAN, GAME_MOTION_WINDOW_MS, GAME_ROUND_END_MS, GAME_SCRAMBLE_MS, GAME_WALK_RADIUS, isMusicalChairsActive, type MusicalChairsState } from '../shared/minigames.ts';
import type { Ack, Player, Vec3 } from '../shared/protocol.ts';

type Motion = { at:number;distance:number;points:Vec3[] };
export type MinigameHooks = {
  now:()=>number;random:()=>number;players:Map<string,Player>;occupancy:Map<string,string>;
  conductorOccupied:()=>boolean;release:(player:Player)=>void;
  relocate:(player:Player,position:Vec3,yaw?:number)=>void;
  repairPositions:()=>void;dirty:()=>void;
};
const ok=():Ack=>({ok:true});
const fail=(error:string):Ack=>({ok:false,error});
const initial=(now:number,version=0):MusicalChairsState=>({kind:'musical-chairs',gameId:null,phase:'lobby',hostId:null,participants:[],roster:{},alive:[],eliminated:[],round:0,chairs:[],seats:{},movement:{},phaseStartedAt:now,phaseEndsAt:null,musicVariant:0,winnerId:null,singerId:null,lastEliminatedId:null,message:null,teleportVersion:version});

// Convex hull + rotating calipers keeps dense network path samples O(n log n).
// Pairwise comparison would let tiny circular movement block the room's tick.
function hasRequiredSpan(points:Vec3[]):boolean{
  if(points.length<2)return false;
  const sorted=[...points].sort((a,b)=>a[0]-b[0]||a[2]-b[2]);
  const cross=(a:Vec3,b:Vec3,c:Vec3)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
  const half=(values:Vec3[])=>{const out:Vec3[]=[];for(const p of values){while(out.length>=2&&cross(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}out.pop();return out;};
  const hull=[...half(sorted),...half([...sorted].reverse())];
  const distant=(a:Vec3,b:Vec3)=>(a[0]-b[0])**2+(a[2]-b[2])**2>=(GAME_MIN_SPAN-1e-9)**2;
  if(hull.length<2)return false;if(hull.length===2)return distant(hull[0],hull[1]);
  let opposite=1;
  for(let i=0;i<hull.length;i++){
    const next=(i+1)%hull.length;
    while(cross(hull[i],hull[next],hull[(opposite+1)%hull.length])>cross(hull[i],hull[next],hull[opposite])+1e-12)opposite=(opposite+1)%hull.length;
    if(distant(hull[i],hull[opposite])||distant(hull[next],hull[opposite]))return true;
  }
  return false;
}

/** Room-local authority. Only public state is serialized; the random stop remains private. */
export class MusicalChairsGame {
  state:MusicalChairsState;
  private musicStopAt:number|null=null;
  private readonly motion=new Map<string,Motion[]>();
  private readonly successfulClaims=new Map<string,string>();
  constructor(private readonly hooks:MinigameHooks){this.state=initial(hooks.now());}

  action(player:Player,data:Record<string,unknown>):Ack{
    const g=this.state;
    switch(data.action){
      case 'join': {
        if(g.phase!=='lobby')return fail('比赛已经开始，请观战或等待重新报名');
        if(g.participants.includes(player.id))return ok();
        if(g.participants.length>=GAME_MAX_PLAYERS)return fail('抢凳子最多 6 人报名');
        g.participants.push(player.id);g.roster[player.id]={name:player.name,shirtColor:player.avatar.shirtColor};g.hostId??=player.id;this.hooks.dirty();return ok();
      }
      case 'leave':this.departed(player.id);return ok();
      case 'start': {
        if(g.phase!=='lobby'||g.hostId!==player.id)return fail('只有主持可以开始报名中的比赛');
        if(g.participants.length<GAME_MIN_PLAYERS||g.participants.length>GAME_MAX_PLAYERS)return fail('需要 3–6 人报名才能开始');
        if(this.hooks.conductorOccupied())return fail('请先离开指挥台再开始比赛');
        g.gameId=randomUUID();g.alive=[...g.participants];g.eliminated=[];g.winnerId=null;g.singerId=null;g.round=0;g.message=null;
        for(const id of g.alive){const p=this.hooks.players.get(id);if(p)this.hooks.release(p);}
        this.beginRound(this.hooks.now(),true);return ok();
      }
      case 'claim':return this.claim(player,data);
      case 'cancel':
        if(g.hostId!==player.id)return fail('只有主持可以取消比赛');
        if(!isMusicalChairsActive(g)&&g.phase!=='lobby')return fail('比赛已经结束');
        this.finish(null,'主持取消了比赛');return ok();
      case 'reset':
        if(g.phase!=='finished'||(g.hostId!==player.id&&g.winnerId!==player.id))return fail('比赛结束后主持或冠军可以重新开放报名');
        this.state=initial(this.hooks.now(),g.teleportVersion);this.motion.clear();this.successfulClaims.clear();this.hooks.dirty();return ok();
      case 'nominate':
        if(g.phase!=='finished'||g.winnerId!==player.id)return fail('只有冠军可以点名唱歌');
        if(typeof data.playerId!=='string'||data.playerId===player.id||!g.participants.includes(data.playerId)||!this.hooks.players.has(data.playerId))return fail('请选择其他仍在线的本局参赛者');
        g.singerId=data.playerId;g.message=`${g.roster[data.playerId].name} 被冠军点名唱歌`;this.hooks.dirty();return ok();
      default:return fail('小游戏操作无效');
    }
  }

  claim(player:Player,data:Record<string,unknown>):Ack{
    const g=this.state;
    if(typeof data.assetId!=='string'||typeof data.gameId!=='string'||!Number.isInteger(data.round)||data.gameId!==g.gameId||data.round!==g.round)return fail('这把椅子所属的比赛或轮次已经结束');
    if(!g.alive.includes(player.id))return fail('只有本轮参赛者可以抢凳子');
    if(this.successfulClaims.get(player.id)===data.assetId)return ok();
    if(g.phase!=='scramble')return fail('请等音乐停止后再抢凳子');
    if(!g.movement[player.id]?.eligible)return fail('走动不足：最近 4 秒需要走过至少 0.8 米，跨度至少 0.4 米');
    const chair=g.chairs.find(c=>c.id===data.assetId);
    if(!chair)return fail('游戏椅不存在');
    if(player.mode!=='walk'||player.assetId)return fail('每人只能抢一把椅子');
    if(g.seats[chair.id]||this.hooks.occupancy.has(chair.id))return fail('这里已经有人了');
    if(Math.hypot(player.position[0]-chair.approach[0],player.position[2]-chair.approach[2])>chair.radius||Math.abs(player.position[1]-chair.approach[1])>1.25)return fail('请先走近一点');
    // Synchronous validation and assignment makes competing socket requests atomic.
    g.seats[chair.id]=player.id;this.hooks.occupancy.set(chair.id,player.id);this.successfulClaims.set(player.id,chair.id);
    player.assetId=chair.id;player.mode='sit';this.hooks.relocate(player,chair.position,chair.rotation);this.hooks.dirty();
    if(Object.keys(g.seats).length===g.alive.length-1){const seated=new Set(Object.values(g.seats));this.eliminate(g.alive.find(id=>!seated.has(id))!,'未抢到椅子');}
    return ok();
  }

  moved(player:Player,from:Vec3,points:Vec3[],distance:number):void{
    if(this.state.phase!=='music'||!this.state.alive.includes(player.id)||distance<=.0001)return;
    const samples=this.motion.get(player.id)??[];samples.push({at:this.hooks.now(),distance,points:[[...from],...points.map(p=>[...p] as Vec3)]});this.motion.set(player.id,samples);
    this.refreshMovement(this.hooks.now());
  }

  tick(now:number):void{
    // The 50 ms broadcast loop advances deadlines even if no client sends commands.
    for(let guard=0;guard<32;guard++){
      const g=this.state;
      if(g.phase==='music'){
        if(this.musicStopAt!==null&&now>=this.musicStopAt){const at=this.musicStopAt;this.refreshMovement(at);this.musicStopAt=null;this.phase('scramble',at,at+GAME_SCRAMBLE_MS);continue;}
        this.refreshMovement(now);break;
      }
      if(g.phaseEndsAt===null||now<g.phaseEndsAt)break;
      const at=g.phaseEndsAt;
      if(g.phase==='countdown'){this.beginMusic(at);continue;}
      if(g.phase==='roundEnd'){this.beginRound(at,false);continue;}
      if(g.phase==='scramble'){this.timeout(at);continue;}
      break;
    }
  }

  departed(id:string):void{
    const g=this.state;if(!g.participants.includes(id))return;
    const player=this.hooks.players.get(id);
    if(g.phase==='lobby'){
      g.participants=g.participants.filter(p=>p!==id);delete g.roster[id];
    }else if(isMusicalChairsActive(g)&&g.alive.includes(id)){
      if(player)this.hooks.release(player);
      for(const [chair,owner] of Object.entries(g.seats))if(owner===id){delete g.seats[chair];this.hooks.occupancy.delete(chair);}
      g.alive=g.alive.filter(p=>p!==id);if(!g.eliminated.includes(id))g.eliminated.push(id);g.lastEliminatedId=id;
      if(g.alive.length<=1)this.finish(g.alive[0]??null,g.alive.length?'其他参赛者退赛，获得退赛胜利':'参赛者全部退赛，比赛取消');
      else {this.musicStopAt=null;g.message=`${g.roster[id].name} 退赛`;this.phase('roundEnd',this.hooks.now(),this.hooks.now()+GAME_ROUND_END_MS);}
    }
    if(g.hostId===id)g.hostId=g.participants.find(p=>p!==id&&this.hooks.players.has(p)&&(!isMusicalChairsActive(g)||!g.eliminated.includes(p)))??g.participants.find(p=>p!==id&&this.hooks.players.has(p))??null;
    if(g.singerId===id)g.singerId=null;
    // Disconnect cleanup runs before the room removes the departing player.
    // Reopen an abandoned result so connected spectators cannot get stranded.
    if(g.phase==='finished'&&!g.participants.some(p=>p!==id&&this.hooks.players.has(p))){
      this.state=initial(this.hooks.now(),g.teleportVersion);this.motion.clear();this.successfulClaims.clear();
    }
    this.hooks.dirty();
  }

  private beginRound(at:number,countdown:boolean):void{
    const g=this.state;
    if(g.alive.length<=1){this.finish(g.alive[0]??null,'比赛结束');return;}
    this.clearSeats();g.round++;g.chairs=createGameChairs(g.gameId!,g.round,g.alive.length);g.movement={};this.motion.clear();this.successfulClaims.clear();
    this.phase(countdown?'countdown':'music',at,countdown?at+GAME_COUNTDOWN_MS:null);
    g.alive.forEach((id,index)=>{const player=this.hooks.players.get(id);if(!player)return;this.hooks.release(player);const angle=index*Math.PI*2/g.alive.length;
      this.hooks.relocate(player,[GAME_CENTER[0]+Math.sin(angle)*GAME_WALK_RADIUS,0,GAME_CENTER[2]+Math.cos(angle)*GAME_WALK_RADIUS],angle+Math.PI);g.movement[id]={distance:0,eligible:false};});
    this.hooks.repairPositions();
    if(!countdown)this.beginMusic(at);
  }

  private beginMusic(at:number):void{
    const random=Math.max(0,Math.min(1,this.hooks.random()));
    const delay=Math.min(5000,Math.floor(random*5001));
    // Interleaved variants avoid revealing a coarse range of the private stop time.
    this.musicStopAt=at+9000+delay;this.state.musicVariant=delay%3;this.motion.clear();
    for(const id of this.state.alive)this.state.movement[id]={distance:0,eligible:false};this.phase('music',at,null);
  }

  private refreshMovement(now:number):void{
    for(const id of this.state.alive){
      const samples=(this.motion.get(id)??[]).filter(s=>s.at>now-GAME_MOTION_WINDOW_MS&&s.at<=now);this.motion.set(id,samples);
      const distance=samples.reduce((total,s)=>total+s.distance,0);
      const eligible=distance>=GAME_MIN_DISTANCE-1e-9&&new Set(samples.map(s=>s.at)).size>=2&&hasRequiredSpan(samples.flatMap(s=>s.points));
      const previous=this.state.movement[id];if(!previous||Math.abs(previous.distance-distance)>.00001||previous.eligible!==eligible){this.state.movement[id]={distance,eligible};this.hooks.dirty();}
    }
  }

  private timeout(at:number):void{
    const g=this.state,seated=new Set(Object.values(g.seats)),waiting=g.alive.filter(id=>!seated.has(id));
    if(g.alive.length===2&&seated.size===0){this.finish(null,'决赛双方都未坐下，比赛取消');return;}
    waiting.sort((a,b)=>Number(g.movement[a]?.eligible??false)-Number(g.movement[b]?.eligible??false)||(g.movement[a]?.distance??0)-(g.movement[b]?.distance??0)||g.participants.indexOf(a)-g.participants.indexOf(b));
    const id=waiting[0];if(id)this.eliminate(id,g.movement[id]?.eligible?'抢座超时，走动距离较少（同距按报名顺序）':'抢座超时，走动未达标',at);
  }

  private eliminate(id:string,reason:string,at=this.hooks.now()):void{
    const g=this.state;g.alive=g.alive.filter(p=>p!==id);g.eliminated.push(id);g.lastEliminatedId=id;g.message=`${g.roster[id].name} 淘汰：${reason}`;
    if(g.alive.length===1)this.finish(g.alive[0],`${g.roster[g.alive[0]].name} 获得冠军`);
    else this.phase('roundEnd',at,at+GAME_ROUND_END_MS);
  }

  private clearSeats():void{
    for(const chair of this.state.chairs){const owner=this.hooks.occupancy.get(chair.id),player=owner&&this.hooks.players.get(owner);if(player)this.hooks.release(player);this.hooks.occupancy.delete(chair.id);}
    this.state.seats={};
  }

  private finish(winnerId:string|null,message:string):void{
    this.clearSeats();this.state.chairs=[];this.musicStopAt=null;this.state.winnerId=winnerId;this.state.message=message;this.phase('finished',this.hooks.now(),null);this.hooks.repairPositions();
  }

  private phase(phase:MusicalChairsState['phase'],at:number,end:number|null):void{this.state.phase=phase;this.state.phaseStartedAt=at;this.state.phaseEndsAt=end;this.hooks.dirty();}
}
