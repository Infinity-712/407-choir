import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {COLOR_TEAMS,type ColorTeam} from '../../shared/color-war';
import type {Ack,RoomLayout,RoomState} from '../../shared/protocol';
import './color-war.css';

export type ColorWarPanelProps={state:RoomState|null;self:string;open:boolean;disabled:boolean;controlsBlocked?:boolean;blocked?:boolean;onBack?:()=>void;onClose:()=>void;onCommand:(event:string,payload:Record<string,unknown>)=>Promise<Ack>;onThrow:()=>void;onGoTo:(assetId:string)=>void;layout:RoomLayout;aimElevation:number;onAimElevation:(degrees:number)=>void};
const noteName=(midi:number)=>['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][midi%12];
export function ColorWarPanel({state,self,open,disabled,controlsBlocked=false,blocked=false,onBack,onClose,onCommand,onThrow,onGoTo,layout,aimElevation,onAimElevation}:ColorWarPanelProps){
  const game=state?.colorWar,member=game?.members[self],me=state?.players[self],host=game?.hostId===self;
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(Date.now()),[collapsed,setCollapsed]=useState(false);
  const closeRef=useRef(onClose);closeRef.current=onClose;
  const dialog=useRef<HTMLElement>(null),clock=useRef({server:state?.serverTime??Date.now(),local:Date.now()});
  useEffect(()=>{clock.current={server:state?.serverTime??Date.now(),local:Date.now()};setNow(clock.current.server);},[state?.serverTime]);
  useEffect(()=>{if(!open&&!member)return;const timer=setInterval(()=>setNow(clock.current.server+Date.now()-clock.current.local),150);return()=>clearInterval(timer);},[open,!!member]);
  useEffect(()=>{if(game?.phase==='countdown'&&open)closeRef.current();},[game?.phase,open]);
  useEffect(()=>{if(!open)return;const before=document.activeElement;dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeRef.current();}if(e.key==='Tab'){const items=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')??[]);if(!items.length)return;const first=items[0],last=items.at(-1)!;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);if(before instanceof HTMLElement&&before.isConnected)before.focus();};},[open]);
  const command=async(event:string,payload:Record<string,unknown>={})=>{if(busy||disabled||(blocked&&event!=='leave'))return;setBusy(true);setError('');try{const result=await onCommand('color-war:'+event,payload);if(!result.ok)setError(result.error||'操作未成功，请重试');}catch{setError('连接暂时不可用，请重试');}finally{setBusy(false);}};
  const active=game?.phase==='playing'||game?.phase==='countdown',remaining=Math.max(0,Math.ceil(((game?.phase==='countdown'?game.startsAt:game?.endsAt)??now)-now)/1000),seconds=Math.ceil(remaining);
  const team=COLOR_TEAMS.find(t=>t.id===member?.team),event=game?.event&&game.event.expiresAt>now?game.event:null;
  const roster=Object.entries(game?.members??{}),canStart=roster.length>=2&&roster.every(([,m])=>m.ready)&&new Set(roster.map(([,m])=>m.team)).size>=2;
  const scores=<div className="cw-scores" aria-label="队伍积分">{COLOR_TEAMS.map(t=><div key={t.id} style={{'--team':t.color} as CSSProperties}><i/>{t.id}<strong>{game?.scores[t.id]??0}</strong></div>)}</div>;
  return <>
    {member&&active&&!open&&!controlsBlocked&&<section className={'cw-hud'+(collapsed?' cw-collapsed':'')} aria-label="颜色战争对局">
      <header><span><i style={{background:team?.color}}/>{team?.id}队 · 颜色战争</span><strong role="timer">{game?.phase==='countdown'?`准备 ${seconds}`:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}</strong><button aria-label={collapsed?'展开对局信息':'收起对局信息'} onClick={()=>setCollapsed(!collapsed)}>{collapsed?'＋':'−'}</button></header>
      {!collapsed&&<>{scores}{event&&<div className="cw-task"><strong>{event.kind==='chair'?'幸运座位 +20':'旋律挑战 +15 · 散射12秒'}</strong><small>剩余 {Math.max(0,Math.ceil((event.expiresAt-now)/1000))} 秒</small>{event.kind==='chair'?<button disabled={disabled||me?.mode!=='walk'||!event.assetId} onClick={()=>event.assetId&&onGoTo(event.assetId)}>前往 {layout.assets.find(a=>a.id===event.assetId)?.label??'发光座位'}</button>:<><p className="cw-notes">{event.melody.map((note,i)=><span key={i} className={i<(event.progress[self]??0)?'done':''}>{noteName(note)}</span>)}</p><button onClick={()=>{const piano=layout.assets.find(a=>a.type==='piano'&&!state?.occupancy[a.id]);if(piano)onGoTo(piano.id);}} disabled={disabled||me?.mode!=='walk'||!layout.assets.some(a=>a.type==='piano'&&!state?.occupancy[a.id])}>前往空闲钢琴</button><small>在真实钢琴弹奏 C4–B4，音符间隔不超过3秒</small></>}</div>}<p className="cw-tip">敌队 +10 · 友伤 −8{member.scatterUntil>now?' · 三连散射中':''}</p></>}
    </section>}
    {member&&game?.phase==='playing'&&!open&&!controlsBlocked&&['walk','sit'].includes(me?.mode??'')&&<div className="cw-throw-controls"><label>仰角 {aimElevation}°<input aria-label="投掷仰角" type="range" min={-10} max={45} step={1} value={aimElevation} onChange={e=>onAimElevation(Number(e.target.value))} disabled={disabled}/></label><button className="cw-throw" disabled={disabled||!['walk','sit'].includes(me?.mode??'')||member.nextThrowAt>now} onClick={onThrow}>{member.nextThrowAt>now?'装填中…':'投掷气球'}<kbd>F</kbd></button><small>拖动视角选择方向，再调整仰角</small></div>}
    {open&&<div className="cw-backdrop" onClick={onClose}><section ref={dialog} className="cw-panel" role="dialog" aria-modal="true" aria-labelledby="cw-title" aria-busy={busy} onClick={e=>e.stopPropagation()}>
      <header><div><span className="cw-eyebrow">407 · 合唱派对</span><h2 id="cw-title">颜色战争</h2></div><button className="cw-close" aria-label="关闭颜色战争" onClick={onClose}>×</button></header>
      {onBack&&<button className="party-back-button" onClick={onBack}>← 所有派对游戏</button>}
      {blocked&&<p className="party-busy-note" role="status">小屋正在玩抢凳子，本局结束或全部退出报名后再来报名。</p>}
      <p className="cw-intro">把小屋变成调色盘。选择声部队伍，用颜料气球一起争夺积分。</p>
      {game?.phase==='finished'?<div className="cw-result"><h3>{game.winners.length?`${game.winners.join('、')} 队获胜！`:'本局结束'}</h3><p>{game.finishReason}</p>{scores}{host&&<button className="cw-primary" disabled={busy||disabled||blocked} onClick={()=>void command('reset')}>再来一局</button>}</div>:active?<><p className="cw-live-notice">{member?'对局正在进行，关闭面板继续投掷。':'对局正在进行。本局可旁观，结束后加入下一局。'}</p>{scores}{host&&<button className="cw-secondary" disabled={busy||disabled||blocked} onClick={()=>void command('stop')}>结束本局</button>}</>:<>
        <div className="cw-teams" role="group" aria-label="选择声部队伍">{COLOR_TEAMS.map(t=>{const count=roster.filter(([,m])=>m.team===t.id).length;return <button key={t.id} style={{'--team':t.color} as CSSProperties} aria-label={`加入${t.id}队`} aria-pressed={member?.team===t.id} disabled={busy||disabled||blocked||(count>=4&&member?.team!==t.id)} onClick={()=>void command('join',{team:t.id as ColorTeam})}><i/><b>{t.id}</b><span>{t.label}</span><small>{count}/4</small></button>;})}</div>
        <div className="cw-roster">{roster.length?roster.map(([id,m])=><div key={id}><b>{m.team}</b><span>{state?.players[id]?.name??'伙伴'}{id===self?'（你）':''}{id===game?.hostId?' · 主持':''}</span><small>{m.ready?'已准备':'准备中'}</small></div>):<p>还没有人报名，选队成为本局主持。</p>}</div>
        <div className="cw-actions">{member&&<button className="cw-primary" disabled={busy||disabled||blocked} onClick={()=>void command('ready',{ready:!member.ready})}>{member.ready?'取消准备':'我准备好了'}</button>}{host&&<button className="cw-primary" disabled={busy||disabled||blocked||!canStart} onClick={()=>void command('start')}>开始比赛</button>}</div><p className="cw-hint">至少2人、2支队伍，全员准备后由主持开始。每队最多4人。</p>
      </>}
      {member&&<button className="cw-text" disabled={busy||disabled} onClick={()=>void command('leave')}>退出颜色战争</button>}
      <details className="cw-rules"><summary>怎么玩 · 规则与操作</summary><ol><li>每局3分钟。击中敌队 +10，误伤队友 −8。命中后短暂保护，不淘汰。</li><li>拖动视角选择方向，调整仰角，按 F 或按钮投掷；手机用左侧摇杆移动。气球受重力影响，家具和墙会挡住它。</li><li>幸运座位：找到发光的真实椅子，首位坐下的玩家 +20。</li><li>旋律挑战：在任意真实钢琴弹出提示的5个音，首位完成 +15 并获12秒三连散射。弹错重新匹配，停顿超过3秒重新开始。</li><li>油彩会自行消退，不改动你的形象；白队有深色描边。队伍并列最高分时共同获胜。</li></ol></details>
      <p role="status" className="cw-status">{busy?'正在同步…':error||(!disabled?'': '连接或房间仍在准备，请稍候')}</p>
    </section></div>}
  </>;
}
