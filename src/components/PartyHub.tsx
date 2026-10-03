import {useEffect,useRef} from 'react';
import {ArrowRight,Armchair,Gamepad2,Palette,X} from 'lucide-react';
import {getOccupiedPartyGame} from '../../shared/party-games';
import type {RoomState} from '../../shared/protocol';
import './party-hub.css';

export function usePartyDialog(onClose:()=>void){
  const dialog=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const before=document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close.current();}
      if(event.key!=='Tab')return;
      const items=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')??[]);
      const first=items[0],last=items.at(-1);if(!first||!last)return;
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    window.addEventListener('keydown',key,true);
    return()=>{window.removeEventListener('keydown',key,true);if(before instanceof HTMLElement&&before.isConnected)before.focus();};
  },[]);
  return dialog;
}

export function PartyHub({state,onOpen,onClose}:{state:RoomState;onOpen:(game:'chairs'|'colorWar')=>void;onClose:()=>void}){
  const dialog=usePartyDialog(onClose),occupied=getOccupiedPartyGame(state);
  const chairs=state.minigame?.participants.length??0,colors=Object.keys(state.colorWar?.members??{}).length;
  return <div className="party-backdrop" onClick={onClose}>
    <section className="party-hub" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="party-hub-title" onClick={event=>event.stopPropagation()}>
      <header><div><Gamepad2 size={22}/><h2 id="party-hub-title">派对游戏</h2></div><button className="party-close" aria-label="关闭派对游戏" onClick={onClose}><X size={20}/></button></header>
      <p className="party-hub-intro">喊上小屋里的伙伴，一起玩一局。</p>
      <div className="party-hub-cards">
        <button aria-label="抢凳子" onClick={()=>onOpen('chairs')}><i className="party-hub-art"><Armchair size={32}/></i><span><strong>抢凳子</strong><small>音乐停下，抢到最后一个位置。</small><em>3–6 人 · 约 1–3 分钟</em>{occupied==='musical-chairs'&&<b>{state.minigame?.phase==='lobby'?`${chairs} 人已报名`:'正在进行 · 查看本局'}</b>}</span><ArrowRight size={18}/></button>
        <button aria-label="颜色战争" onClick={()=>onOpen('colorWar')}><i className="party-hub-art paint"><Palette size={32}/></i><span><strong>颜色战争</strong><small>组队投掷颜料，完成音乐挑战。</small><em>2–20 人 · 每局 3 分钟</em>{occupied==='color-war'&&<b>{state.colorWar?.phase==='lobby'?`${colors} 人已报名`:'正在进行 · 查看本局'}</b>}</span><ArrowRight size={18}/></button>
      </div>
      <p className="party-hub-note">{occupied?`小屋正在${occupied==='musical-chairs'?'集合玩抢凳子':'集合玩颜色战争'}。本局结束或全部退出报名后，可以切换另一款。`:'同一个小屋一次组织一款游戏，未报名的伙伴可以围观。'}</p>
    </section>
  </div>;
}
