import {useEffect,useRef,useState,type CSSProperties,type KeyboardEvent} from 'react';
import {MessageCircle,Send,X} from 'lucide-react';
import type {BubbleStyle} from '../../shared/protocol';

const STORAGE_KEY='407-chat-style-v1';
const LIMIT=80;
const PALETTES=[['cream','奶油白'],['lavender','薰衣草'],['mint','薄荷绿'],['peach','蜜桃粉']] as const;
const SHAPES=[['round','圆角气泡'],['cloud','云朵气泡']] as const;
const EMOJI=[['😊','微笑'],['😄','大笑'],['💕','比心'],['👏','鼓掌'],['🎵','音符'],['🎉','庆祝'],['👍','点赞'],['✨','星星']] as const;
const truncate=(text:string)=>Array.from(text).slice(0,LIMIT).join('');
function loadStyle():BubbleStyle{
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null') as Partial<BubbleStyle>|null;
    return {
      palette:PALETTES.some(([value])=>value===saved?.palette)?saved!.palette!:'cream',
      shape:SHAPES.some(([value])=>value===saved?.shape)?saved!.shape!:'round',
    };
  }catch{return {palette:'cream',shape:'round'};}
}

export type ChatComposerProps={
  onSend:(text:string,style:BubbleStyle)=>Promise<boolean>;
  onClose:()=>void;
  disabled?:boolean;
};

export function ChatComposer({onSend,onClose,disabled=false}:ChatComposerProps){
  const [draft,setDraft]=useState(''),[style,setStyle]=useState<BubbleStyle>(loadStyle),[sending,setSending]=useState(false);
  const [viewport,setViewport]=useState({inset:0,height:window.innerHeight,keyboard:false});
  const input=useRef<HTMLTextAreaElement>(null),composing=useRef(false),busy=useRef(false);
  const selection=useRef({start:0,end:0});
  const length=Array.from(draft).length,unavailable=disabled||sending;

  useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify(style));}catch{}},[style]);
  useEffect(()=>{
    const viewportApi=window.visualViewport;
    let baselineHeight=window.innerHeight,baselineWidth=window.innerWidth;
    const update=()=>{
      if(Math.abs(window.innerWidth-baselineWidth)>100){baselineWidth=window.innerWidth;baselineHeight=window.innerHeight;}
      const height=viewportApi?.height??window.innerHeight,offset=viewportApi?.offsetTop??0;
      const inset=Math.max(0,window.innerHeight-height-offset);
      setViewport({inset,height,keyboard:inset>100||height<baselineHeight-120});
    };
    update();viewportApi?.addEventListener('resize',update);viewportApi?.addEventListener('scroll',update);window.addEventListener('resize',update);
    const frame=requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));
    return()=>{cancelAnimationFrame(frame);viewportApi?.removeEventListener('resize',update);viewportApi?.removeEventListener('scroll',update);window.removeEventListener('resize',update);};
  },[]);

  const rememberSelection=()=>{if(input.current)selection.current={start:input.current.selectionStart,end:input.current.selectionEnd};};
  const insertEmoji=(emoji:string)=>{
    if(unavailable)return;
    const {start,end}=selection.current;
    const prefix=draft.slice(0,start),suffix=draft.slice(end),next=prefix+emoji+suffix;
    if(Array.from(next).length>LIMIT)return;
    setDraft(next);
    const caret=prefix.length+emoji.length;selection.current={start:caret,end:caret};
    requestAnimationFrame(()=>{input.current?.focus({preventScroll:true});input.current?.setSelectionRange(caret,caret);});
  };
  const send=async()=>{
    if(unavailable||busy.current||composing.current||!draft.trim()||length>LIMIT)return;
    busy.current=true;setSending(true);
    try{
      if(await onSend(draft.trim(),style)){setDraft('');selection.current={start:0,end:0};}
    }finally{busy.current=false;setSending(false);}
  };
  const keyDown=(event:KeyboardEvent<HTMLElement>)=>{
    event.stopPropagation();
    if(composing.current||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;
    if(event.key==='Escape'){event.preventDefault();onClose();return;}
    if(event.key==='Enter'&&!event.shiftKey&&event.target===input.current){event.preventDefault();void send();}
  };
  return <section className="social-panel chat-composer" role="dialog" aria-label="聊天" data-keyboard={viewport.keyboard}
    style={{'--chat-keyboard-inset':`${viewport.inset}px`,'--chat-available-height':`${viewport.height}px`} as CSSProperties}
    onKeyDown={keyDown} onKeyUp={event=>event.stopPropagation()}>
    <header className="social-panel-heading"><div><MessageCircle size={20}/><h2>说点什么吧</h2></div><button type="button" className="social-close" aria-label="关闭聊天" onClick={onClose}><X size={19}/></button></header>
    <p className="social-intro">话语会出现在你的名字上方，和大家打个招呼。</p>
    <div className="chat-input-wrap"><label className="social-sr-only" htmlFor="room-chat-input">聊天内容</label><textarea id="room-chat-input" ref={input} rows={2} placeholder="今天想聊些什么？" value={draft} readOnly={unavailable}
      aria-describedby="chat-length" onChange={event=>{setDraft(composing.current?event.target.value:truncate(event.target.value));rememberSelection();}}
      onSelect={rememberSelection} onCompositionStart={()=>{composing.current=true;}}
      onCompositionEnd={event=>{composing.current=false;setDraft(truncate(event.currentTarget.value));rememberSelection();}}/>
      <span id="chat-length" className={'chat-counter'+(length>LIMIT?' over-limit':'')}>{length} / {LIMIT}</span></div>
    <div className="chat-emoji" role="group" aria-label="添加表情">{EMOJI.map(([emoji,label])=><button type="button" key={emoji} aria-label={label} title={label} disabled={unavailable} onPointerDown={event=>event.preventDefault()} onClick={()=>insertEmoji(emoji)}>{emoji}</button>)}</div>
    <details className="chat-appearance"><summary>装扮我的气泡<span>会自动记住</span></summary><div className="chat-appearance-content">
      <div className="chat-palette-options" role="group" aria-label="气泡颜色">{PALETTES.map(([palette,label])=><button type="button" key={palette} data-palette={palette} aria-label={label} title={label} aria-pressed={style.palette===palette} onClick={()=>setStyle(current=>({...current,palette}))}><span/></button>)}</div>
      <div className="chat-shape-options" role="group" aria-label="气泡形状">{SHAPES.map(([shape,label])=><button type="button" key={shape} aria-pressed={style.shape===shape} onClick={()=>setStyle(current=>({...current,shape}))}>{label}</button>)}</div>
      <div className="chat-style-preview" aria-label="气泡预览"><span className="speech-bubble" data-palette={style.palette} data-shape={style.shape}>你好呀，一起唱歌吧 🎵</span></div>
    </div></details>
    <footer className="chat-composer-footer"><span>Enter 发送 · Shift + Enter 换行</span><button type="button" className="primary-button chat-send" aria-label="发送消息" disabled={unavailable||!draft.trim()||length>LIMIT} onClick={()=>void send()}><Send size={17}/>{sending?'发送中…':'发送'}</button></footer>
  </section>;
}
