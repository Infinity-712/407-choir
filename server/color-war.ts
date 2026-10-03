import { COLOR_TEAMS, COLOR_WAR_RULES as R, COLOR_WAR_BODY as BODY, throwOrigin, type ColorTeam, type ColorWarState, type ColorWarProjectile } from '../shared/color-war.ts';
import { groundHeight, withinRoom } from '../shared/movement.ts';
import type { Ack, InteractionAsset, PianoEvent, Player, RoomLayout, Vec3 } from '../shared/protocol.ts';

export type ColorWarContext = {players:Map<string,Player>;occupancy:Map<string,string>};
const ok=():Ack=>({ok:true});
const fail=(error:string):Ack=>({ok:false,error});
const scores=():Record<ColorTeam,number>=>({S:0,A:0,T:0,B:0,P:0});
const team=(value:unknown):value is ColorTeam=>COLOR_TEAMS.some(t=>t.id===value);
const owns=(value:object,key:string)=>Object.hasOwn(value,key);
const polygon=(points:[number,number][],x:number,z:number)=>{
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
};

/** Server-only rules. Every position and ownership check comes from the room. */
export class ColorWarGame {
  private state:ColorWarState|undefined;
  private readonly now:()=>number;
  private readonly random:()=>number;
  private lastTick=0;
  private nextEventAt=0;
  private serial=0;
  private readonly noteTimes=new Map<string,number>();
  constructor(private readonly layout:RoomLayout,options:{now?:()=>number;random?:()=>number}={}){
    this.now=options.now??Date.now;this.random=options.random??Math.random;
  }
  snapshot():ColorWarState|undefined{return this.state?structuredClone(this.state):undefined;}
  private member(id:string){return this.state&&owns(this.state.members,id)?this.state.members[id]:undefined;}
  private activeTeams(){return [...new Set(Object.values(this.state!.members).map(m=>m.team))];}
  private newState():ColorWarState{return {phase:'lobby',hostId:null,round:0,startsAt:0,endsAt:0,members:Object.create(null),scores:scores(),projectiles:[],splashes:[],event:null,winners:[],finishReason:null};}
  command(id:string,event:string,payload:Record<string,unknown>,context:ColorWarContext):Ack{
    this.tick(context);
    const player=context.players.get(id);if(!player)return fail('请先加入房间');
    if(event==='color-war:join'){
      if(!team(payload.team))return fail('请选择 SATBP 队伍');
      if(this.state&&this.state.phase!=='lobby')return fail('本局已开始，请等下一局报名');
      const state=this.state??this.newState();
      const current=owns(state.members,id)?state.members[id]:undefined;
      if(Object.values(state.members).filter(m=>m.team===payload.team).length-(current?.team===payload.team?1:0)>=R.teamLimit)return fail('每队最多4人');
      if(!current&&Object.keys(state.members).length>=R.playerLimit)return fail('本局已满20人');
      if(current?.team===payload.team)return ok();
      state.members[id]={team:payload.team,ready:false,score:0,nextThrowAt:0,scatterUntil:0,immuneUntil:0};
      state.hostId??=id;this.state=state;return ok();
    }
    const state=this.state,member=this.member(id);if(!state||!member)return fail('请先报名颜色战争');
    switch(event){
      case 'color-war:leave':this.removePlayer(id,context);return ok();
      case 'color-war:ready':
        if(state.phase!=='lobby'||typeof payload.ready!=='boolean')return fail('只能在大厅设置准备状态');
        member.ready=payload.ready;return ok();
      case 'color-war:start':
        if(state.hostId!==id)return fail('只有主持人可以开始');
        if(state.phase!=='lobby'||Object.keys(state.members).length<2||this.activeTeams().length<2||Object.values(state.members).some(m=>!m.ready))return fail('至少两队且全员准备后才能开始');
        state.phase='countdown';state.round++;state.startsAt=this.now()+R.countdownMs;state.endsAt=state.startsAt+R.durationMs;
        state.scores=scores();state.winners=[];state.finishReason=null;this.lastTick=state.startsAt;this.nextEventAt=state.startsAt+R.eventFirstMs;return ok();
      case 'color-war:stop':
        if(state.hostId!==id)return fail('只有主持人可以终止');
        if(state.phase!=='playing'&&state.phase!=='countdown')return fail('当前没有进行中的比赛');
        this.finish('主持人结束了本局');return ok();
      case 'color-war:reset':
        if(state.hostId!==id||state.phase!=='finished')return fail('请由主持人在结算后重新开局');
        state.phase='lobby';state.startsAt=0;state.endsAt=0;state.scores=scores();state.winners=[];state.finishReason=null;
        for(const m of Object.values(state.members)){m.ready=false;m.score=0;m.nextThrowAt=0;m.scatterUntil=0;m.immuneUntil=0;}
        return ok();
      case 'color-war:throw':return this.throw(id,player,payload);
      default:return fail('未知游戏操作');
    }
  }
  private throw(id:string,player:Player,payload:Record<string,unknown>):Ack{
    const state=this.state!,member=this.member(id)!,now=this.now();
    if(state.phase!=='playing')return fail('比赛尚未开始或已经结束');
    if(player.mode!=='walk'&&player.mode!=='sit')return fail('请先离开钢琴或指挥台');
    const direction=payload.direction;
    if(!Array.isArray(direction)||direction.length!==3||!direction.every(v=>typeof v==='number'&&Number.isFinite(v)))return fail('投掷方向无效');
    const length=Math.hypot(...direction);if(length<.001||!Number.isFinite(length))return fail('投掷方向无效');
    if(now<member.nextThrowAt)return fail('气球还在准备中');
    const count=member.scatterUntil>now?3:1;if(state.projectiles.length+count>R.maxProjectiles)return fail('气球太多，请稍后再试');
    member.nextThrowAt=now+R.throwCooldownMs;
    const d=direction.map(v=>v/length),angles=count===3?[-.12,0,.12]:[0];
    for(const angle of angles){
      const dx=d[0]*Math.cos(angle)-d[2]*Math.sin(angle),dz=d[0]*Math.sin(angle)+d[2]*Math.cos(angle);
      state.projectiles.push({id:`ball-${++this.serial}`,ownerId:id,team:member.team,position:throwOrigin(player),velocity:[dx*12,d[1]*12+1.8,dz*12],bornAt:now});
    }
    return ok();
  }
  tick(context:ColorWarContext):boolean{
    const state=this.state;if(!state)return false;const now=this.now();let changed=false;
    if(state.phase==='countdown'&&now>=state.startsAt){state.phase='playing';changed=true;}
    if(state.phase==='playing'){
      const until=Math.min(now,state.endsAt);
      if(state.projectiles.length&&until>this.lastTick){this.advanceProjectiles(this.lastTick,until,context);changed=true;}
      this.lastTick=Math.max(this.lastTick,until);
      if(now>=state.endsAt){this.finish('三分钟比赛结束');return true;}
      for(const m of Object.values(state.members)){
        if(m.scatterUntil&&m.scatterUntil<=now){m.scatterUntil=0;changed=true;}
        if(m.immuneUntil&&m.immuneUntil<=now){m.immuneUntil=0;changed=true;}
      }
      if(state.event&&state.event.expiresAt<=now){state.event=null;this.noteTimes.clear();changed=true;}
      for(const [id,at] of this.noteTimes)if(now-at>R.melodyGapMs){if(state.event)delete state.event.progress[id];this.noteTimes.delete(id);changed=true;}
      if(now>=this.nextEventAt){this.nextEventAt=now+R.eventEveryMs;this.createEvent(context,now);changed=true;}
    }
    const count=state.splashes.length;state.splashes=state.splashes.filter(s=>s.expiresAt>now);return changed||count!==state.splashes.length;
  }
  private advanceProjectiles(from:number,to:number,context:ColorWarContext){
    const state=this.state!;const survivors:ColorWarProjectile[]=[];
    for(const ball of state.projectiles){
      let time=Math.max(from,ball.bornAt),alive=true;
      const limit=Math.min(to,ball.bornAt+3000);
      while(time<limit&&alive){
        // At most 6ms / 7.2cm per segment, with analytic swept hit volumes.
        const dt=Math.min(.006,(limit-time)/1000),start=ball.position;
        const end:Vec3=[start[0]+ball.velocity[0]*dt,start[1]+ball.velocity[1]*dt-4.9*dt*dt,start[2]+ball.velocity[2]*dt];
        let earliest=2,target:Player|undefined;
        const worldHit=this.worldImpact(start,end);if(worldHit!==null)earliest=worldHit;
        for(const [id,member] of Object.entries(state.members)){
          if(id===ball.ownerId||member.immuneUntil>time)continue;
          const player=context.players.get(id);if(!player)continue;
          const t=this.playerHit(start,end,player);
          if(t!==null&&t<earliest){earliest=t;target=player;}
        }
        if(earliest<=1){
          const position=start.map((v,i)=>v+(end[i]-v)*earliest) as Vec3;const at=time+dt*1000*earliest;
          const friendly=!!target&&this.member(target.id)?.team===ball.team;
          if(target){this.award(ball.ownerId,friendly?R.friendlyPoints:R.enemyPoints);this.member(target.id)!.immuneUntil=at+R.immuneMs;}
          state.splashes.push({id:`splash-${++this.serial}`,team:ball.team,position,...(target?{targetId:target.id}:{}),friendly,expiresAt:at+R.splashMs});
          if(state.splashes.length>R.maxSplashes)state.splashes.splice(0,state.splashes.length-R.maxSplashes);alive=false;
        }else{ball.position=end;ball.velocity[1]-=9.8*dt;}
        time+=dt*1000;
      }
      if(alive&&to<ball.bornAt+3000)survivors.push(ball);
    }
    state.projectiles=survivors;
  }
  private boxHit(from:Vec3,to:Vec3,min:Vec3,max:Vec3):number|null{
    let enter=0,exit=1;
    for(let i=0;i<3;i++){const d=to[i]-from[i];if(Math.abs(d)<1e-10){if(from[i]<min[i]||from[i]>max[i])return null;continue;}
      const a=(min[i]-from[i])/d,b=(max[i]-from[i])/d;enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));if(enter>exit)return null;}
    return enter;
  }
  private playerHit(from:Vec3,to:Vec3,player:Player):number|null{
    // Transform the sweep into the same scaled, yawed and seated rig space.
    const local=(p:Vec3):Vec3=>{
      const c=Math.cos(player.yaw),s=Math.sin(player.yaw),forward=player.mode==='piano'?BODY.pianoWorldForward:0;
      // RoomWorld offsets the entire piano rig in world units before scaling.
      const dx=(p[0]-player.position[0]-s*forward)/BODY.scale,dz=(p[2]-player.position[2]-c*forward)/BODY.scale;
      const sitting=player.mode==='sit'||player.mode==='piano';
      let y=(p[1]-player.position[1])/BODY.scale+(sitting?BODY.seatDrop:0),z=dx*s+dz*c-(player.mode==='sit'?BODY.chairForward:0);
      if(player.mode==='piano'){const offset=y-BODY.upperPivot,cos=Math.cos(BODY.pianoLean),sin=Math.sin(BODY.pianoLean);y=BODY.upperPivot+offset*cos+z*sin;z=-offset*sin+z*cos;}
      return [dx*c-dz*s,y,z];
    };
    const a=local(from),b=local(to),width=player.avatar.faceWidth;
    const radii=[BODY.headRadius[0]*width,...BODY.headRadius.slice(1)];
    const origin=a.map((v,i)=>(v-(i===1?BODY.headCenter:0))/radii[i]);
    const delta=b.map((v,i)=>(v-a[i])/radii[i]);
    const aa=delta.reduce((sum,v)=>sum+v*v,0),bb=2*origin.reduce((sum,v,i)=>sum+v*delta[i],0),cc=origin.reduce((sum,v)=>sum+v*v,0)-1;
    let head:number|null=cc<=0?0:null;
    if(head===null&&aa>1e-15){const discriminant=bb*bb-4*aa*cc;if(discriminant>=0){const t=(-bb-Math.sqrt(discriminant))/(2*aa);if(t>=0&&t<=1)head=t;}}
    const torso=this.boxHit(a,b,[-BODY.torsoRadius,BODY.torsoBottom,-BODY.torsoDepth],[BODY.torsoRadius,BODY.torsoTop,BODY.torsoDepth]);
    // Standing trousers/shoes occupy the lower body. Seated knees bend forward,
    // so a standing column below the chair would create an invisible target.
    const legs=player.mode==='sit'||player.mode==='piano'?null:this.boxHit(a,b,[-.155,.02,-.09],[.155,BODY.torsoBottom,.15]);
    const hits=[head,torso,legs].filter((t):t is number=>t!==null);return hits.length?Math.min(...hits):null;
  }
  private worldImpact(from:Vec3,to:Vec3):number|null{
    let hit:number|null=null;
    // Boundary / stepped floor samples are tighter than the balloon radius.
    for(let i=0;i<=4;i++){const t=i/4,p=from.map((v,k)=>v+(to[k]-v)*t) as Vec3;
      if(!withinRoom(this.layout,p[0],p[2],.04)||p[1]<=groundHeight(this.layout,p[0],p[2])+.04){hit=t;break;}}
    for(const c of this.layout.colliders){
      const t=this.boxHit(from,to,[c.min[0]-.04,(c.minY??0)-.04,c.min[1]-.04],[c.max[0]+.04,(c.maxY??3)+.04,c.max[1]+.04]);
      if(t===null||(hit!==null&&t>=hit))continue;
      if(!c.footprint){hit=t;continue;}
      const exact=this.prismHit(from,to,c.footprint,(c.minY??0)-.04,(c.maxY??3)+.04);
      if(exact!==null&&(hit===null||exact<hit))hit=exact;
    }
    return hit;
  }
  private prismHit(from:Vec3,to:Vec3,points:[number,number][],bottom:number,top:number):number|null{
    const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2],cuts=[0,1];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],ex=b[0]-a[0],ez=b[1]-a[1],den=dx*ez-dz*ex;
      if(Math.abs(den)<1e-12)continue;
      const ax=a[0]-from[0],az=a[1]-from[2],t=(ax*ez-az*ex)/den,u=(ax*dz-az*dx)/den;
      if(t>=0&&t<=1&&u>=0&&u<=1)cuts.push(t);
    }
    if(Math.abs(dy)>1e-12)for(const h of [bottom,top]){const t=(h-from[1])/dy;if(t>=0&&t<=1)cuts.push(t);}
    cuts.sort((a,b)=>a-b);
    for(let i=0;i<cuts.length-1;i++){const mid=(cuts[i]+cuts[i+1])/2,y=from[1]+dy*mid;
      if(y>=bottom&&y<=top&&polygon(points,from[0]+dx*mid,from[2]+dz*mid))return cuts[i];}
    return null;
  }
  private award(id:string,points:number){const member=this.member(id);if(member){member.score+=points;this.state!.scores[member.team]+=points;}}
  private pick<T>(items:T[]):T{return items[Math.min(items.length-1,Math.max(0,Math.floor(this.random()*items.length)))];}
  private createEvent(context:ColorWarContext,now:number){
    const state=this.state!;this.noteTimes.clear();
    const chairs=this.layout.assets.filter(a=>a.type==='chair'&&!context.occupancy.has(a.id));
    const piano=this.layout.assets.some(a=>a.type==='piano');
    const kinds:('chair'|'melody')[]=[...(chairs.length?['chair' as const]:[]),...(piano?['melody' as const]:[])];
    if(!kinds.length){state.event=null;return;}
    const kind=this.pick(kinds);state.event={id:`event-${++this.serial}`,kind,expiresAt:now+R.eventLifetimeMs,melody:[],progress:Object.create(null)};
    if(kind==='chair')state.event.assetId=this.pick(chairs).id;
    // Short white-key phrases are readable on the phone's one-octave keyboard.
    else state.event.melody=[...this.pick([
      [60,62,64,62,60],[64,64,62,62,60],[60,64,67,64,60],
      [67,65,64,62,60],[60,60,67,67,69],[64,65,67,65,64],
    ])];
  }
  onClaim(player:Player,asset:InteractionAsset,context:ColorWarContext):boolean{
    const changed=this.tick(context),state=this.state,event=state?.event;
    if(state?.phase!=='playing'||!this.member(player.id)||event?.kind!=='chair'||event.assetId!==asset.id||asset.type!=='chair'||player.mode!=='sit'||player.assetId!==asset.id||context.occupancy.get(asset.id)!==player.id)return changed;
    this.award(player.id,R.chairPoints);state.event=null;this.noteTimes.clear();return true;
  }
  onPiano(player:Player,event:PianoEvent,context:ColorWarContext):boolean{
    const changed=this.tick(context),state=this.state,task=state?.event;
    if(event.kind==='clear')return this.onRelease(player.id)||changed;
    if(state?.phase!=='playing'||task?.kind!=='melody'||!this.member(player.id)||event.kind!=='on'||player.mode!=='piano'||!player.assetId||context.occupancy.get(player.assetId)!==player.id||!this.layout.assets.some(a=>a.id===player.assetId&&a.type==='piano')||!Number.isInteger(event.midi)||event.midi!<21||event.midi!>108)return changed;
    const progress=task.progress[player.id]??0;
    const next=event.midi===task.melody[progress]?progress+1:event.midi===task.melody[0]?1:0;
    task.progress[player.id]=next;this.noteTimes.set(player.id,this.now());
    if(next===task.melody.length){this.award(player.id,R.melodyPoints);this.member(player.id)!.scatterUntil=this.now()+R.scatterMs;state.event=null;this.noteTimes.clear();}
    return true;
  }
  onRelease(id:string):boolean{
    const had=this.noteTimes.delete(id);const event=this.state?.event;
    if(event&&owns(event.progress,id)){delete event.progress[id];return true;}return had;
  }
  removePlayer(id:string,context:ColorWarContext):boolean{
    this.tick(context);const state=this.state;if(!state||!this.member(id))return false;
    this.onRelease(id);delete state.members[id];state.projectiles=state.projectiles.filter(p=>p.ownerId!==id);
    if(state.hostId===id)state.hostId=Object.keys(state.members)[0]??null;
    if(!state.hostId){this.state=undefined;this.noteTimes.clear();return true;}
    if((state.phase==='playing'||state.phase==='countdown')&&this.activeTeams().length<2)this.finish('人数或参赛队伍不足，本局结束');
    return true;
  }
  private finish(reason:string){
    const state=this.state!;state.phase='finished';state.finishReason=reason;
    const teams=this.activeTeams(),best=Math.max(...teams.map(t=>state.scores[t]));state.winners=teams.filter(t=>state.scores[t]===best);
    state.projectiles=[];state.splashes=[];state.event=null;this.noteTimes.clear();
    for(const member of Object.values(state.members)){member.scatterUntil=0;member.immuneUntil=0;member.nextThrowAt=0;member.ready=false;}
  }
}
