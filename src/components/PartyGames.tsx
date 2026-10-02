import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Armchair,Check,Crown,Flag,Gamepad2,Music2,Users,X} from 'lucide-react';
import type {MinigameAction,MusicalChairsState} from '../../shared/minigames';
import {GAME_MIN_PLAYERS,GAME_MAX_PLAYERS,isMusicalChairsActive} from '../../shared/minigames';
import type {RoomState} from '../../shared/protocol';

type Props={state:RoomState;self:string;connected:boolean;onAction:(action:MinigameAction)=>Promise<boolean>;onClose:()=>void};
const nameOf=(state:RoomState,id:string|null)=>id?(state.players[id]?.name??state.minigame?.roster[id]?.name??'离开的伙伴'):'伙伴';
function Person({state,id,self}:{state:RoomState;id:string;self:string}){
  const name=nameOf(state,id),color=state.players[id]?.avatar.shirtColor??state.minigame?.roster[id]?.shirtColor??'#bfa9ed';
  return <><span className="party-avatar" style={{background:color}}>{[...name][0]}</span><span className="party-person-text">{name}{id===self&&<small>你</small>}</span></>;
}
export function PartyGames({state,self,connected,onAction,onClose}:Props){
  const game=state.minigame,phase=game?.phase??'lobby',joined=game?.participants.includes(self)??false;
  const host=game?.hostId===self,winner=game?.winnerId===self,playing=isMusicalChairsActive(game);
  const [busy,setBusy]=useState(false);
  const send=async(action:MinigameAction)=>{if(busy)return;setBusy(true);try{const success=await onAction(action);if(success&&action.action==='start')onClose();}finally{setBusy(false);}};
  const participants=game?.participants??[];
  return <section className="party-panel" data-testid="party-panel" role="dialog" aria-labelledby="party-title" aria-modal="false">
    <header className="party-panel-heading"><div><Gamepad2 size={21}/><h2 id="party-title">派对游戏</h2></div><button className="party-close" aria-label="关闭派对游戏" onClick={onClose}><X size={20}/></button></header>
    <article className="party-game-card"><span className="party-card-icon"><Armchair size={30}/></span><div><h3>抢凳子</h3><p>音乐一停，抢到你的专属位置。</p><span className="party-tag"><Users size={13}/>{GAME_MIN_PLAYERS}–{GAME_MAX_PLAYERS} 人 · 约 1–3 分钟</span></div></article>
    <details className="party-rules" open={!game||phase==='lobby'}><summary>怎么玩 <span>电脑与手机都能参加</span></summary><ol><li>至少 3 人报名，主持人点击开始。每轮比人数少一把凳子。</li><li>音乐响起时绕圈或来回走动，不能坐下；原地转向或小幅抖动不算。</li><li>音乐一停，点击凳子或上方编号，走近后自动抢座；电脑也可走近按 E。</li><li>每轮淘汰一位，最终两人抢一椅。冠军可以点名一位参赛伙伴唱歌。</li></ol><p>最近 4 秒需走过约 0.8 米，并挪开至少 0.4 米。抢座以服务器收到的有效操作为准；12 秒超时会按走动表现淘汰一位，决赛无人落座则结束比赛。</p></details>
    {phase==='lobby'&&<><div className="party-section-title"><h3>等伙伴来集合</h3><span>{participants.length} / {GAME_MAX_PLAYERS} 人</span></div><p className="party-muted">{game?.hostId?`${nameOf(state,game.hostId)}是主持人`:'第一个报名的伙伴会成为主持人。'}</p>
      <ul className="party-roster">{participants.map(id=><li key={id}><Person state={state} id={id} self={self}/>{id===game?.hostId?<span className="party-role">主持</span>:<Check size={15}/>}</li>)}</ul>
      {!participants.length&&<div className="party-empty">先占个名额，再喊朋友一起来。</div>}
      <div className="party-actions"><button className="primary-button" disabled={busy||!connected||(!joined&&participants.length>=GAME_MAX_PLAYERS)} onClick={()=>void send({action:joined?'leave':'join'})}>{joined?'退出报名':'报名参加'}<ArrowRight size={17}/></button>{host&&<button className="party-start" disabled={busy||!connected||participants.length<GAME_MIN_PLAYERS} onClick={()=>void send({action:'start'})}>开始游戏</button>}</div>
      {participants.length<GAME_MIN_PLAYERS&&<p className="party-footnote">还差 {GAME_MIN_PLAYERS-participants.length} 位伙伴就能开始。</p>}</>}
    {playing&&<><div className="party-section-title"><h3>第 {game!.round} 轮</h3><span>{game!.alive.length} 人 · {game!.chairs.length} 把凳子</span></div><p className="party-muted">{game!.alive.includes(self)?'你正在场上，关掉面板继续玩。':joined?'这一局你已淘汰，可以自由逛逛或给伙伴加油。':'这一局正在进行，下一局再报名吧。'}</p><ul className="party-roster">{participants.map(id=><li key={id}><Person state={state} id={id} self={self}/><span className="party-role">{game!.eliminated.includes(id)?'观战':game!.alive.includes(id)?'在场':'已退出'}</span></li>)}</ul><button className="primary-button full" onClick={onClose}>回到场上</button><div className="party-secondary-actions">{joined&&<button disabled={busy||!connected} onClick={()=>void send({action:'leave'})}>退出本局</button>}{host&&<button disabled={busy||!connected} onClick={()=>void send({action:'cancel'})}>结束本局</button>}</div></>}
    {phase==='finished'&&<><div className="party-result"><Crown size={31}/><h3>{game?.winnerId?`${nameOf(state,game.winnerId)}拿下冠军！`:'这一局结束啦'}</h3><p>{game?.message}</p></div>{game?.winnerId&&<><h3 className="party-nominate-heading">{winner?'选一位伙伴，听听 TA 的歌':'冠军可以点名一位伙伴唱歌'}</h3>{winner&&<div className="party-nominees">{participants.filter(id=>id!==self&&!!state.players[id]).map(id=><button key={id} aria-label={`点名${nameOf(state,id)}唱歌`} aria-pressed={game.singerId===id} disabled={busy||!connected} onClick={()=>void send({action:'nominate',playerId:id})}><Person state={state} id={id} self={self}/>{game.singerId===id?<Check size={17}/>:<Music2 size={17}/>}</button>)}</div>}{game.singerId&&<p className="party-singer-result">🎤 {nameOf(state,game.singerId)}被冠军点名{game.singerId===self?'，轮到你唱歌啦':''}</p>}<p className="party-footnote">想唱就点击开启麦克风；点名不会自动打开任何人的麦克风。</p></>}{(host||winner)&&<button className="primary-button full" disabled={busy||!connected} onClick={()=>void send({action:'reset'})}>再玩一局，重新报名</button>}</>}
    <p className="party-footnote">关闭这个面板会继续留在本局。音乐暂用自制鼓点。</p>
  </section>;
}
export function PartyStatus({state,self,onOpen,onChair,connected}:{state:RoomState;self:string;onOpen:()=>void;onChair:(id:string)=>void;connected:boolean}){
  const game=state.minigame;
  const [now,setNow]=useState(Date.now());
  const offset=useRef(state.serverTime-Date.now());
  useEffect(()=>{offset.current=state.serverTime-Date.now();},[state.serverTime]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(timer);},[]);
  if(!game||game.phase==='lobby')return null;
  const moving=game.phase==='music',scramble=game.phase==='scramble',alive=game.alive.includes(self),motion=game.movement[self];
  const remaining=game.phaseEndsAt===null?null:Math.max(0,Math.ceil((game.phaseEndsAt-now-offset.current)/1000));
  const title=moving?'音乐响起，动起来':scramble?'音乐停了，快抢凳子':game.phase==='countdown'?'准备，马上开始':game.phase==='roundEnd'?'这一轮结束啦':game.winnerId?`${nameOf(state,game.winnerId)}是冠军`:'比赛结束';
  return <aside className={'party-status'+(scramble?' scramble':'')+(game.phase==='finished'?' finished':'')} data-testid="party-status" data-phase={game.phase} aria-label="抢凳子游戏进度">
    <div className="party-status-top"><span className="party-status-icon">{game.phase==='finished'?<Crown size={19}/>:moving?<Music2 size={19}/>:<Flag size={19}/>}</span><div><strong>{title}</strong><small>{game.phase==='finished'?game.message:`第 ${game.round} 轮 · ${game.alive.length} 位伙伴 / ${game.chairs.length} 把凳子`}</small></div>{remaining!==null&&game.phase!=='finished'&&<b className="party-clock">{remaining}</b>}<button aria-label="查看抢凳子规则与进度" onClick={onOpen}>详情</button></div>
    {moving&&alive&&<div className={'party-motion'+(motion?.eligible?' ready':'')}><span>{motion?.eligible?'走动达标，保持移动':'继续走动 · 原地转向不算'}</span><meter min={0} max={.8} value={motion?.distance??0} aria-label="走动距离"/></div>}
    {scramble&&alive&&state.players[self]?.mode==='walk'&&<><p className="party-seat-tip">{motion?.eligible?'点凳子编号，走近后抢座':'这一轮走动未达标，暂不能抢座'}</p><div className="party-chair-actions">{game.chairs.map((chair,i)=><button key={chair.id} aria-label={`抢凳子 ${i+1}`} disabled={!connected||!motion?.eligible||!!game.seats[chair.id]} onClick={()=>onChair(chair.id)}><Armchair size={15}/>{i+1}{game.seats[chair.id]&&<Check size={12}/>}</button>)}</div></>}
    {!alive&&game.phase!=='finished'&&<p className="party-seat-tip">{game.participants.includes(self)?'你在观战，给伙伴加油吧':'观战中 · 下一局再来一起玩'}</p>}
    {game.lastEliminatedId&&game.phase==='roundEnd'&&<p className="party-seat-tip">{nameOf(state,game.lastEliminatedId)}本轮淘汰 · {game.message}</p>}
    {game.phase==='finished'&&game.singerId&&<p className="party-singer-result">🎤 {nameOf(state,game.singerId)}被冠军点名{game.singerId===self?'，轮到你唱歌啦':''}</p>}
  </aside>;
}
