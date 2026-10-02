import {Hand,Heart,RotateCcw,Sparkles,X} from 'lucide-react';
import type {ChoirPose} from '../../shared/protocol';

const POSES:{value:ChoirPose;label:string;hint:string}[]=[
  {value:'raise-left',label:'左臂抬起',hint:'左手向上'},
  {value:'raise-right',label:'右臂抬起',hint:'右手向上'},
  {value:'raise-both',label:'双臂抬起',hint:'一起举起来'},
  {value:'hand-left-chest',label:'左手抚右胸',hint:'左手放在右胸前'},
  {value:'hand-right-chest',label:'右手抚左胸',hint:'右手放在左胸前'},
];

function PoseIcon({pose}:{pose:ChoirPose}){
  const left=pose==='raise-left'||pose==='raise-both'?'M17 19 L23 9':pose==='hand-left-chest'?'M17 19 L9 23':'M17 19 L21 29';
  const right=pose==='raise-right'||pose==='raise-both'?'M11 19 L5 9':pose==='hand-right-chest'?'M11 19 L19 23':'M11 19 L7 29';
  return <svg viewBox="0 0 28 38" width="29" height="38" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><circle cx="14" cy="10" r="4" fill="currentColor" fillOpacity=".15"/><path d="M11 18 Q14 16 17 18 L17 28 L11 28 Z" fill="currentColor" fillOpacity=".12"/><path d={left}/><path d={right}/><path d="M12 28 L11 35 M16 28 L17 35"/></svg>;
}

export type ActionMenuProps={pose:ChoirPose|null;onPose:(pose:ChoirPose|null)=>void;onEmote:(emote:'wave'|'clap'|'heart')=>void;onClose:()=>void;disabled?:boolean};

export function ActionMenu({pose,onPose,onEmote,onClose,disabled=false}:ActionMenuProps){
  return <section className="social-panel action-menu" role="dialog" aria-label="表情与动作" onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();onClose();}}}>
    <header className="social-panel-heading"><div><Sparkles size={20}/><h2>和大家打个招呼</h2></div><button type="button" className="social-close" aria-label="关闭动作" onClick={onClose}><X size={19}/></button></header>
    <div className="social-emotes" role="group" aria-label="短暂动作"><button type="button" disabled={disabled} onClick={()=>onEmote('wave')}><Hand size={22}/>挥手</button><button type="button" disabled={disabled} onClick={()=>onEmote('clap')}><span className="social-clap" aria-hidden="true"><Hand size={21}/><Hand size={21}/></span>鼓掌</button><button type="button" disabled={disabled} onClick={()=>onEmote('heart')}><Heart size={22}/>比心</button></div>
    <div className="action-section-heading"><h3>合唱姿势</h3><span>再次点击可放下</span></div>
    <div className="choir-pose-grid" role="group" aria-label="持续姿势">{POSES.map(item=><button type="button" key={item.value} aria-label={item.label} title={item.hint} aria-pressed={pose===item.value} disabled={disabled} onClick={()=>onPose(pose===item.value?null:item.value)}><PoseIcon pose={item.value}/><span>{item.label}</span></button>)}<button type="button" className="pose-reset" disabled={disabled||pose===null} onClick={()=>onPose(null)}><RotateCcw size={24}/><span>恢复姿势</span></button></div>
    <p className="social-footnote">姿势会保持，直到你放下或切换到其他动作。</p>
  </section>;
}
