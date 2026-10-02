import { useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ArrowLeft, ArrowRight, AudioLines, Check, CircleHelp, Copy, DoorOpen, Hand, Heart, Headphones, Mic, MicOff, MoreHorizontal, Music2, MessageCircle, Palette, Pause, Piano, Play, RotateCcw, Settings2, Shuffle, Sparkles, Users, Volume2, VolumeX, WandSparkles, X } from 'lucide-react';
import { AvatarPreview } from './avatar/AvatarPreview';
import { AvatarEditor } from './components/AvatarEditor';
import { TouchJoystick } from './components/TouchJoystick';
import { FullscreenControl } from './components/FullscreenControl';
import { ChatComposer } from './components/ChatComposer';
import { ActionMenu } from './components/SocialActions';
import { PartyGames, PartyStatus } from './components/PartyGames';
import { PartyAudio } from './audio/PartyAudio';
import { isGameChair, isMusicalChairsActive, type MinigameAction } from '../shared/minigames';
import { Gamepad2 } from 'lucide-react';
import './party.css';
import { loadAvatar, randomAvatar, saveAvatar } from '../shared/avatar';
import { DEFAULT_AVATAR, type Ack, type AvatarConfig, type Emote, type ChoirPose, type BubbleStyle, type ConductorGesture, type BeatPattern, type InteractionAsset, type PianoEvent, type RoomLayout, type RoomState, type Vec3 } from '../shared/protocol';
import { RoomWorld } from './scene/RoomWorld';
import { PianoAudio } from './audio/PianoAudio';
import { VoiceChat, type MicStatus } from './audio/VoiceChat';
import { parseQualityMode, type RenderQualityMode } from '../shared/render-quality';
import { PerformanceInput } from '../shared/performance-input';

const read=(key:string,fallback:string)=>{try{return localStorage.getItem(key)||fallback;}catch{return fallback;}};
const write=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{}};
const KEY_CODES=['KeyA','KeyW','KeyS','KeyE','KeyD','KeyF','KeyT','KeyG','KeyY','KeyH','KeyU','KeyJ','KeyK','KeyO','KeyL','KeyP','Semicolon'];
const KEY_NAMES=['A','W','S','E','D','F','T','G','Y','H','U','J','K','O','L','P',';'];
const BLACK=new Set([1,3,6,8,10]);
function IconButton({label,children,onClick,active=false,disabled=false}:{label:string;children:ReactNode;onClick:()=>void;active?:boolean;disabled?:boolean}){return <button className={'icon-button'+(active?' active':'')} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;}
function Brand(){return <div className="brand"><span className="brand-symbol"><AudioLines size={23}/></span><div><b>407</b><span>合唱小屋</span></div></div>;}
export default function App(){
  const [avatar,setAvatar]=useState<AvatarConfig>(loadAvatar),[name,setName]=useState(()=>read('407-name','')),[roomId,setRoomId]=useState(()=>new URLSearchParams(location.search).get('room')||'407');
  const [page,setPage]=useState<'studio'|'room'>('studio'),[joining,setJoining]=useState(false),[state,setState]=useState<RoomState|null>(null),[self,setSelf]=useState(''),[connected,setConnected]=useState(false),[layout,setLayout]=useState<RoomLayout|null>(null);
  const [progress,setProgress]=useState(0),[hovered,setHovered]=useState<InteractionAsset|null>(null),[toast,setToast]=useState(''),[mic,setMic]=useState<MicStatus>('off'),[speaking,setSpeaking]=useState<Set<string>>(new Set());
  const [touchUI,setTouchUI]=useState(()=>matchMedia('(max-width:760px), (pointer:coarse)').matches),[placesOpen,setPlacesOpen]=useState(false),[emotesOpen,setEmotesOpen]=useState(false),[micSensitivity,setMicSensitivity]=useState(60);
  const [moreOpen,setMoreOpen]=useState(false),[fullscreenHelpOpen,setFullscreenHelpOpen]=useState(false);
  const [panel,setPanel]=useState<'people'|'settings'|'help'|'wardrobe'|'chat'|'party'|null>(null),[pianoVolume,setPianoVolume]=useState(.65),[voiceVolume,setVoiceVolume]=useState(.55),[muted,setMuted]=useState<Set<string>>(new Set()),[pressed,setPressed]=useState<Set<number>>(new Set()),[octave,setOctave]=useState(60),[pedal,setPedal]=useState(false),[beat,setBeat]=useState(0);
  const [qualityMode,setQualityMode]=useState<RenderQualityMode>(()=>parseQualityMode(read('407-quality','auto')));
  const [effectiveQuality,setEffectiveQuality]=useState<'standard'|'smooth'>(()=>qualityMode==='smooth'||(qualityMode==='auto'&&matchMedia('(pointer:coarse)').matches)?'smooth':'standard');
  const lowQuality=effectiveQuality==='smooth';
  const mobileOverlayOpen=touchUI&&(moreOpen||placesOpen||emotesOpen||!!panel||fullscreenHelpOpen);
  const mobileOverlayRef=useRef(mobileOverlayOpen);mobileOverlayRef.current=mobileOverlayOpen;
  useEffect(()=>{write('407-quality',qualityMode);world.current?.setQualityMode(qualityMode);if(qualityMode!=='auto')setEffectiveQuality(qualityMode);},[qualityMode]);
  const host=useRef<HTMLDivElement>(null),world=useRef<RoomWorld|null>(null),socket=useRef<Socket|null>(null),piano=useRef<PianoAudio|null>(null),voice=useRef<VoiceChat|null>(null),stateRef=useRef<RoomState|null>(null),selfRef=useRef(''),toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null),heldRef=useRef(new Set<number>()),meRef=useRef({mode:'walk',assetId:null as string|null}),joinData=useRef({name:'',roomId:'',avatar:DEFAULT_AVATAR});
  const me=state?.players[self],players=Object.values(state?.players??{}),isPiano=me?.mode==='piano';
  const partyAudio=useRef<PartyAudio|null>(null);
  const partyPlaying=isMusicalChairsActive(state?.minigame);
  const gameParticipant=partyPlaying&&!!state?.minigame?.alive.includes(self);
  useEffect(()=>{partyAudio.current?.setVolume(pianoVolume);},[pianoVolume]);
  const visibleKeys=Math.min(touchUI?12:24,109-octave),whiteKeys=Array.from({length:visibleKeys},(_,i)=>i).filter(i=>!BLACK.has((octave+i)%12)).length;
  const performanceInput=useRef(new PerformanceInput()),panelRef=useRef(panel);panelRef.current=panel;
  const movementSequence=useRef(0),recoveredThrough=useRef(0),movementRecovery=useRef(false),claimPending=useRef(false);
  const canControlWorld=()=>!!socket.current?.connected&&meRef.current.mode!=='piano'&&!['wardrobe','help','chat','party'].includes(panelRef.current??'')&&!mobileOverlayRef.current&&!claimPending.current&&!movementRecovery.current;
  const notify=(message:string)=>{setToast(message);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),5000);};
  const request=(event:string,data:unknown={}):Promise<Ack>=>new Promise(resolve=>{const s=socket.current;if(!s?.connected){resolve({ok:false,error:'连接正在恢复，请稍等'});return;}s.timeout(5000).emit(event,data,(error:Error|null,result:Ack)=>resolve(error?{ok:false,error:'连接响应较慢，请重试'}:result??{ok:false,error:'操作没有成功'}));});
  const sendMovement=async(data:{position:Vec3;yaw:number;via:Vec3[]}):Promise<Ack>=>{
    const sequence=++movementSequence.current,s=socket.current,id=selfRef.current;
    const result=await request('move',data);
    if(!result.ok&&sequence>recoveredThrough.current&&!movementRecovery.current&&socket.current===s&&selfRef.current===id){
      // Pause new moves, then ask behind all moves already sent on this socket.
      // A delayed rejection must not restore a pose older than a later success.
      recoveredThrough.current=movementSequence.current;movementRecovery.current=true;
      world.current?.setInputEnabled(false);
      try{
        const synchronized=await request('sync');
        if(socket.current===s&&selfRef.current===id){
          const authoritative=synchronized.state?.players[id];
          if(authoritative)world.current?.reconcilePosition(authoritative.position,authoritative.yaw);
          else if(!synchronized.ok)notify(synchronized.error||'位置同步较慢，请稍后再试');
        }
      }finally{
        movementRecovery.current=false;
        if(!claimPending.current&&socket.current===s&&selfRef.current===id)world.current?.setInputEnabled(canControlWorld());
      }
    }
    return result;
  };
  const sendPiano=(event:PianoEvent)=>{if(meRef.current.mode!=='piano'||!socket.current?.connected)return;piano.current?.event(event,selfRef.current);socket.current.emit('piano',event);if(event.midi!==undefined&&meRef.current.assetId)world.current?.key(meRef.current.assetId,event.midi,event.kind==='on');};
  const clearNotes=()=>{performanceInput.current.clear();heldRef.current.clear();setPressed(new Set());setPedal(false);piano.current?.clear(selfRef.current);world.current?.clearKeys(meRef.current.assetId??undefined);if(meRef.current.mode==='piano')socket.current?.emit('piano',{kind:'clear'});};
  const noteOn=(midi:number,source='pointer')=>{if(mobileOverlayRef.current||midi<21||midi>108||!performanceInput.current.press(midi,source))return;heldRef.current.add(midi);setPressed(new Set(heldRef.current));void piano.current?.resume();sendPiano({kind:'on',midi,velocity:.8});};
  const noteOff=(midi:number,source='pointer')=>{if(!performanceInput.current.release(midi,source))return;heldRef.current.delete(midi);setPressed(new Set(heldRef.current));sendPiano({kind:'off',midi});};
  const setSustain=(down:boolean,source='pointer')=>{if(down&&mobileOverlayRef.current)return;if(performanceInput.current.pedal(down,source)){const active=performanceInput.current.isSustained();setPedal(active);sendPiano({kind:'sustain',down:active});}};
  const interact=async(asset:InteractionAsset)=>{
    const current=stateRef.current?.players[selfRef.current],s=socket.current,id=selfRef.current;
    if(!current||claimPending.current||movementRecovery.current)return;
    if(current.mode!=='walk'){notify('先退出当前互动，再试试其他物件');return;}
    claimPending.current=true;
    const movement=world.current?.takeMovement();
    world.current?.setInputEnabled(false);
    try{
      if(movement){const moved=await sendMovement(movement);if(socket.current!==s||selfRef.current!==id)return;if(!moved.ok){notify(moved.error||'位置正在同步，请再试一次');return;}}
      const game=stateRef.current?.minigame;
      const result=await request('claim',{assetId:asset.id,...(isGameChair(asset.id)&&game?{gameId:game.gameId,round:game.round}:{})});
      if(socket.current!==s||selfRef.current!==id)return;
      if(result.ok&&asset.type==='piano')voice.current?.disable();
      if(!result.ok)notify(result.error||'暂时无法使用');
    }finally{
      claimPending.current=false;
      if(!movementRecovery.current&&socket.current===s&&selfRef.current===id)world.current?.setInputEnabled(canControlWorld());
    }
  };
  const release=async()=>{if(isGameChair(meRef.current.assetId??'')&&isMusicalChairsActive(stateRef.current?.minigame)){togglePanel('party');return;}clearNotes();const result=await request('release');if(!result.ok)notify(result.error||'暂时无法退出');};
  useEffect(()=>{void fetch('/assets/interaction-layout.json').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(setLayout).catch(()=>notify('房间资源暂时无法加载，请刷新重试'));return()=>{if(toastTimer.current)clearTimeout(toastTimer.current);};},[]);
  useEffect(()=>{saveAvatar(avatar);},[avatar]);
  useEffect(()=>()=>{socket.current?.removeAllListeners();socket.current?.disconnect();voice.current?.dispose();partyAudio.current?.dispose();piano.current?.dispose();world.current?.dispose();},[]);
  async function enter(){
    if(!name.trim()){notify('先给自己取个昵称吧');document.getElementById('nickname')?.focus();return;}
    if(!layout){notify('房间还在准备，请稍等');return;}
    setJoining(true);joinData.current={name:name.trim(),roomId:roomId.trim()||'407',avatar};write('407-name',name.trim());saveAvatar(avatar);
    socket.current?.removeAllListeners();socket.current?.disconnect();voice.current?.dispose();partyAudio.current?.dispose();piano.current?.dispose();
    const engine=new PianoAudio();piano.current=engine;engine.setVolume(pianoVolume);await engine.resume();
    const gameAudio=new PartyAudio(engine.context);partyAudio.current=gameAudio;gameAudio.setVolume(pianoVolume);
    const s=io({autoConnect:false,reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:5000,timeout:8000});socket.current=s;
    const chat=new VoiceChat(s,engine.context,setMic,notify,setSpeaking);voice.current=chat;chat.setVolume(voiceVolume);chat.setNoiseGateThreshold(-30-micSensitivity*.3);await chat.configure();
    let everJoined=false;
    const failJoin=(message:string)=>{if(socket.current!==s)return;setJoining(false);s.removeAllListeners();chat.dispose();s.disconnect();gameAudio.dispose();engine.dispose();socket.current=null;voice.current=null;piano.current=null;partyAudio.current=null;notify(message);};
    s.on('state',(next:RoomState)=>{
      if(socket.current!==s||!selfRef.current||!next.players[selfRef.current])return;
      const id=selfRef.current;const old=stateRef.current;stateRef.current=next;setState(next);const player=next.players[id];
      if(player){meRef.current={mode:player.mode,assetId:player.assetId};if(old?.players[id]?.mode==='piano'&&player.mode!=='piano'){clearNotes();voice.current?.disable();}}
      for(const former of Object.values(old?.players??{}))if(former.mode==='piano'&&(!next.players[former.id]||next.players[former.id].mode!=='piano')){engine.clear(former.id);world.current?.clearKeys(former.assetId??undefined);}
      for(const [assetId,notes]of Object.entries(next.notes)){const owner=next.occupancy[assetId];if(owner&&owner!==id)engine.syncNotes(owner,notes,next.pedals?.[assetId]??false);}
      world.current?.setState(next,id);chat.setState(next,id);gameAudio.sync(next.minigame,next.serverTime);
    });
    s.on('piano',(event:PianoEvent)=>{if(event.playerId===selfRef.current)return;engine.event(event);if(event.kind==='clear')world.current?.clearKeys(event.assetId);else if(event.assetId&&event.midi!==undefined)world.current?.key(event.assetId,event.midi,event.kind==='on');});
    s.on('connect',()=>{if(socket.current!==s)return;s.timeout(6000).emit('join',joinData.current,(error:Error|null,result:Ack)=>{if(socket.current!==s)return;setJoining(false);if(error||!result?.ok||!result.id||!result.state){failJoin(result?.error||'暂时进不去房间，请重试');return;}everJoined=true;selfRef.current=result.id;setSelf(result.id);stateRef.current=result.state;setState(result.state);meRef.current={mode:result.state.players[result.id].mode,assetId:null};setConnected(true);setPage('room');chat.setState(result.state,result.id);world.current?.setState(result.state,result.id);for(const [assetId,notes]of Object.entries(result.state.notes)){const owner=result.state.occupancy[assetId];if(owner&&owner!==result.id)engine.syncNotes(owner,notes,result.state.pedals?.[assetId]??false);}});});
    s.on('disconnect',()=>{setConnected(false);chat.disable();gameAudio.sync(null,Date.now());engine.clear();heldRef.current.clear();setPressed(new Set());world.current?.setInputEnabled(false);});
    s.on('connect_error',()=>{if(!everJoined)failJoin('还没有连上房间服务，请稍后重新进入');else notify('连接中断，正在尝试回到小屋');});s.connect();
  }
  const leave=()=>{clearNotes();voice.current?.dispose();voice.current=null;socket.current?.disconnect();socket.current=null;partyAudio.current?.dispose();partyAudio.current=null;piano.current?.dispose();piano.current=null;world.current?.dispose();world.current=null;setPage('studio');setState(null);stateRef.current=null;selfRef.current='';setSelf('');setConnected(false);setProgress(0);setPanel(null);setEmotesOpen(false);setPlacesOpen(false);setMoreOpen(false);setFullscreenHelpOpen(false);setMic('off');setMuted(new Set());};
  useEffect(()=>{if(page!=='room'||!host.current||!layout)return;try{const w=new RoomWorld(host.current,layout,{onMove:(position,yaw,via)=>{if(!claimPending.current&&!movementRecovery.current)void sendMovement({position,yaw,via});},onSelect:setHovered,onQualityChange:setEffectiveQuality,onInteract:asset=>void interact(asset),onLoad:setProgress,onError:notify,onListenerPose:(position,forward,up)=>voice.current?.setListenerPose(position,forward,up)});world.current=w;w.setQualityMode(qualityMode);if(stateRef.current)w.setState(stateRef.current,selfRef.current);return()=>{w.dispose();if(world.current===w)world.current=null;};}catch{notify('三维画面启动失败，请确认浏览器已启用硬件加速');}},[page,layout]);
  useEffect(()=>{world.current?.setInputEnabled(canControlWorld());if(panel==='wardrobe'||panel==='help'||panel==='chat'||panel==='party'||mobileOverlayOpen)clearNotes();},[connected,panel,isPiano,mobileOverlayOpen]);
  useEffect(()=>{if(fullscreenHelpOpen){setMoreOpen(false);setPlacesOpen(false);setEmotesOpen(false);setPanel(null);}},[fullscreenHelpOpen]);
  useEffect(()=>{if(!touchUI){setMoreOpen(false);setPlacesOpen(false);}},[touchUI]);
  useEffect(()=>{if(!isPiano)return;const down=(e:KeyboardEvent)=>{if(e.isComposing||e.keyCode===229||mobileOverlayRef.current||panelRef.current==='chat'||panelRef.current==='help'||panelRef.current==='wardrobe'||panelRef.current==='party')return;if(e.target instanceof HTMLElement&&(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable))return;const index=KEY_CODES.indexOf(e.code);if(index>=0){e.preventDefault();if(!e.repeat)noteOn(octave+index,'key:'+e.code);}if(e.code==='Space'){e.preventDefault();if(!e.repeat)setSustain(true,'key:space');}if(e.code==='Escape'&&!panelRef.current)void release();};const up=(e:KeyboardEvent)=>{const i=KEY_CODES.indexOf(e.code);if(i>=0)noteOff(octave+i,'key:'+e.code);if(e.code==='Space')setSustain(false,'key:space');};const visibility=()=>{if(document.hidden)clearNotes();};window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',clearNotes);document.addEventListener('visibilitychange',visibility);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clearNotes);document.removeEventListener('visibilitychange',visibility);clearNotes();};},[isPiano,octave]);
  useEffect(()=>{if(state?.minigame?.phase==='countdown'&&state.minigame.alive.includes(self)){setPanel(null);setEmotesOpen(false);setPlacesOpen(false);setMoreOpen(false);}if(state?.minigame?.phase==='finished'&&state.minigame.winnerId===self){setEmotesOpen(false);setPlacesOpen(false);setMoreOpen(false);setPanel('party');}},[state?.minigame?.phase,state?.minigame?.winnerId,self]);
  useEffect(()=>{if(!connected||page!=='room')return;partyAudio.current?.sync(state?.minigame,state?.serverTime??Date.now());},[connected,page,state?.minigame?.phase,state?.minigame?.phaseStartedAt]);
  useEffect(()=>{if(page!=='room')return;const shortcut=(e:KeyboardEvent)=>{
    if(e.isComposing||e.keyCode===229||fullscreenHelpOpen)return;
    const editing=e.target instanceof HTMLElement&&(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable);
    if(e.code==='Escape'){if(moreOpen){e.preventDefault();setMoreOpen(false);}else if(placesOpen){e.preventDefault();setPlacesOpen(false);}else if(panel){e.preventDefault();setPanel(null);}else if(emotesOpen){e.preventDefault();setEmotesOpen(false);}else if(!editing&&meRef.current.mode!=='walk'&&meRef.current.mode!=='piano')void release();}
    if(e.code==='Enter'&&!e.repeat&&!editing&&!panel&&!moreOpen&&!placesOpen){e.preventDefault();setEmotesOpen(false);setPlacesOpen(false);world.current?.setInputEnabled(false);clearNotes();setPanel('chat');}
  };window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);},[page,panel,emotesOpen,moreOpen,placesOpen,fullscreenHelpOpen]);
  useEffect(()=>{if(!state?.conductor.playing){setBeat(0);return;}const {bpm,startAt,beats}=state.conductor;let last=-1;const offset=state.serverTime-Date.now();const timer=setInterval(()=>{const n=Math.floor((Date.now()+offset-startAt)/(60000/bpm));if(n>=0&&n!==last){last=n;setBeat(n%beats+1);piano.current?.tick(n%beats===0);}},25);return()=>clearInterval(timer);},[state?.conductor.playing,state?.conductor.bpm,state?.conductor.startAt,state?.conductor.beats]);
  const togglePanel=(next:typeof panel)=>{setMoreOpen(false);setEmotesOpen(false);setPlacesOpen(false);if((next==='chat'||next==='party')&&panel!==next){world.current?.setInputEnabled(false);clearNotes();}setPanel(panel===next?null:next);};
  const toggleMore=()=>{setPanel(null);setPlacesOpen(false);setEmotesOpen(false);setMoreOpen(!moreOpen);};
  const openPlaces=()=>{setMoreOpen(false);setPanel(null);setEmotesOpen(false);setPlacesOpen(true);};
  const emote=async(value:Emote)=>{setEmotesOpen(false);const result=await request('emote',{emote:value});if(!result.ok)notify(result.error||'动作暂时不可用');};
  const pose=async(value:ChoirPose|null)=>{const result=await request('pose',{pose:value});if(!result.ok)notify(result.error||'姿势暂时不可用');};
  const sendChat=async(text:string,style:BubbleStyle)=>{const result=await request('chat',{text,style});if(!result.ok)notify(result.error||'消息没有发出，请重试');return result.ok;};
  const conduct=async(gesture:ConductorGesture,beats?:BeatPattern)=>{const result=await request('conduct-gesture',{gesture,...(beats?{beats}:{})});if(!result.ok)notify(result.error||'手势暂时不可用');};
  const changeAvatar=(next:AvatarConfig)=>{setAvatar(next);joinData.current.avatar=next;if(page==='room')void request('avatar',{avatar:next});};
  const copyLink=async()=>{const url=new URL(location.href);url.searchParams.set('room',state?.roomId||roomId);try{await navigator.clipboard.writeText(url.toString());notify('房间链接已复制，发给伙伴一起加入吧');}catch{notify('当前房间号：'+(state?.roomId||roomId));}};
  useEffect(()=>{const media=matchMedia('(max-width:760px), (pointer:coarse)');const update=()=>setTouchUI(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const actLabel=(asset:InteractionAsset)=>asset.type==='chair'?'坐在这里':asset.type==='piano'?'弹奏钢琴':'开始指挥';
  const partyAction=async(action:MinigameAction)=>{const result=await request('minigame',action);if(!result.ok)notify(result.error||'小游戏操作没有成功');return result.ok;};
  const gameChair=(id:string)=>{const asset=stateRef.current?.minigame?.chairs.find(chair=>chair.id===id);if(asset)world.current?.goTo(asset);};
  const candidate=hovered??world.current?.nearest()??null;
  const active=gameParticipant&&(!candidate||!isGameChair(candidate.id)||state?.minigame?.phase!=='scramble')?null:candidate;
  return <>
    {page==='studio'?<div className="studio-page">
      <header className="site-header"><Brand/><div className="header-note"><span className="tiny-star">✦</span> 一个有音乐，也有你的小地方</div><button className="text-button" onClick={()=>setPanel('help')}><CircleHelp size={17}/>怎么玩</button>{touchUI&&<div className="room-header-actions"><FullscreenControl onOverlayChange={setFullscreenHelpOpen}/></div>}</header>
      <main className="studio-main">
        <section className="studio-heading"><div><div className="eyebrow"><span/> YOUR LITTLE CHOIR CLUB</div><h1>今天，以什么模样<span>登场？<Sparkles size={31}/></span></h1><p>捏一个可爱的自己，来 407 和朋友们碰个面。</p></div><div className="step-track"><span className="current"><b>01</b>捏个自己</span><i/><span><b>02</b>加入小屋</span></div></section>
        <div className="studio-grid">
          <section className="avatar-stage"><div className="stage-top"><span><i/> 我的专属形象</span><span className="small-caps">MADE BY YOU</span></div><div className="stage-spark one">✦</div><div className="stage-spark two">✧</div><div className="stage-ring"/><AvatarPreview lowQuality={lowQuality} config={avatar} className="studio-avatar"/><div className="character-caption"><span className="caption-line"/><b>{name.trim()||'还没取名的小可爱'}</b><span>准备好，制造一点快乐</span></div><div className="stage-bottom"><span><RotateCcw size={14}/>拖动转一转</span><button className="soft-button" onClick={()=>setAvatar(randomAvatar())}><Shuffle size={16}/>灵感随机一下</button></div></section>
          <section className="editor-card"><div className="card-heading"><div><h2>一点点，变成你<span>。</span></h2><p>每一个小细节，都有自己的可爱。</p></div><WandSparkles size={24}/></div><AvatarEditor config={avatar} onChange={setAvatar}/></section>
        </div>
        <section className="join-strip"><div className="join-greeting"><span className="music-stamp"><Music2 size={26}/></span><div><h3>给你的新朋友，留个名字</h3><p>形象会自动记住，下次来还是你。</p></div></div><div className="join-fields"><label htmlFor="nickname">你的昵称<input id="nickname" maxLength={16} placeholder="怎么称呼你？" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!joining)void enter();}}/></label><label className="room-field" htmlFor="room-code">房间号<input id="room-code" maxLength={24} value={roomId} onChange={e=>setRoomId(e.target.value)} /></label><button className="primary-button enter-button" disabled={joining||!layout} onClick={()=>void enter()}>{joining?'正在推开门…':'走，去小屋'}<ArrowRight size={19}/></button></div></section>
        <footer className="studio-footer"><span><Headphones size={14}/>戴上耳机，一起听点好听的</span><span>坐一坐 · 弹弹琴 · 聊聊天</span><span>407 CHOIR CLUB <span className="footer-flower">✳</span></span></footer>
      </main>
    </div>:<div data-quality={effectiveQuality} data-touch-ui={touchUI} className={'room-page'+(isPiano?' playing':'')+(panel||mobileOverlayOpen?' panel-open':'')+(panel==='party'?' party-panel-open':'')+(gameParticipant?' party-playing':'')+((panel==='chat'||emotesOpen)?' social-open':'')}>
      <div className="world-host" ref={host}/>
      <header className="room-header">{touchUI?<><div className="room-identity mobile-room-status"><strong>{state?.roomId} 号小屋</strong><span className={connected?'status-online':'status-offline'}><i/>{connected?`${players.length} 人`:'连接中…'}</span></div><div className="room-header-actions"><FullscreenControl onOverlayChange={setFullscreenHelpOpen}/></div></>:<><div className="room-identity"><Brand/><div className="divider"/><div><strong>{state?.roomId} 号小屋</strong><span className={connected?'status-online':'status-offline'}><i/>{connected?`${players.length} 位伙伴在这里`:'正在重新连接…'}</span></div></div><div className="room-header-actions"><button className="glass-button" onClick={()=>void copyLink()}><Copy size={16}/><span>邀请朋友</span></button><IconButton label="离开房间" onClick={leave}><DoorOpen size={20}/></IconButton></div></>}</header>
      <aside className={'room-places'+(placesOpen?' is-open':'')}><span className="small-caps">在小屋里</span>{touchUI&&<button className="mobile-places-close icon-button" aria-label="关闭地点" onClick={()=>setPlacesOpen(false)}><X size={18}/></button>}{layout?.assets.filter(a=>a.type!=='chair'&&(!partyPlaying||a.id!=='conductor')).map(a=><button key={a.id} disabled={gameParticipant} onClick={()=>{setPlacesOpen(false);world.current?.goTo(a);}}><span className={'place-icon '+a.type}>{a.type==='piano'?<Piano size={20}/>:<Music2 size={20}/>}</span><span>{a.label}<small>{state?.occupancy[a.id]?`${state.players[state.occupancy[a.id]]?.name??'伙伴'}正在使用`:'走过去试试'}</small></span><ArrowRight size={14}/></button>)}<div className="place-hint">点击地面移动<br/>也可以使用 WASD</div></aside>
      {progress<100&&<div className="room-loading"><span className="loading-note"><Music2 size={30}/></span><h2>把小屋准备好…</h2><p>椅子摆好了，琴也调好了。</p><div className="progress-track"><span style={{width:progress+'%'}}/></div><small>{progress}%</small></div>}
      {beat>0&&<div className="beat-display"><Music2 size={15}/><span>{state?.conductor.bpm} BPM</span>{Array.from({length:state?.conductor.beats??4},(_,i)=>i+1).map(n=><i key={n} className={beat===n?'on':''}/>)}</div>}
      {me?.mode==='conduct'&&<section className="conduct-panel social-conduct glass-panel">
        <header className="conduct-heading"><Music2 size={21}/><strong>轮到你指挥啦</strong></header>
        <div className="conduct-patterns" role="group" aria-label="指挥拍型">{([2,3,4] as const).map(n=><button key={n} disabled={!connected} aria-pressed={state?.conductor.beats===n} onClick={()=>void conduct('beat',n)}>{n===2?'二拍':n===3?'三拍':'四拍'}</button>)}</div>
        <div className="conduct-cues" role="group" aria-label="指挥手势">{([['cue','起拍'],['cutoff','收拍'],['crescendo','渐强'],['diminuendo','渐弱']] as const).map(([gesture,label])=><button key={gesture} disabled={!connected} onClick={()=>void conduct(gesture)}>{label}</button>)}</div>
        <div className="conduct-transport"><label>速度 <input aria-label="指挥速度" type="range" min={40} max={200} value={state?.conductor.bpm??96} onChange={e=>void request('tempo',{bpm:Number(e.target.value),playing:state?.conductor.playing})}/><b>{state?.conductor.bpm}</b></label><button className="primary-button" onClick={()=>void request('tempo',{bpm:state?.conductor.bpm,playing:!state?.conductor.playing})}>{state?.conductor.playing?<Pause size={17}/>:<Play size={17}/>} {state?.conductor.playing?'暂停节拍':'预备，开始'}</button><button className="text-button" onClick={()=>void release()}>离开指挥台</button></div>
      </section>}
      {!isPiano&&me?.mode!=='conduct'&&(!gameParticipant||me?.mode==='sit'||!!active)&&<div className={'interaction-prompt'+(me?.mode!=='sit'&&!active?' is-idle':'')}>{me?.mode==='sit'?(partyPlaying&&isGameChair(me.assetId??'')?<><span>抢座成功，等待下一轮。</span><button onClick={()=>togglePanel('party')}>查看本局</button></>:<><span>休息一下，听听大家的声音。</span><button onClick={()=>void release()}><kbd>Esc</kbd>起身</button></>):active?<><span>{active.label}{state?.occupancy[active.id]?' · 已有人入座':''}</span><button onClick={()=>world.current?.goTo(active)}><kbd>E</kbd>{isGameChair(active.id)?'抢这个凳子':actLabel(active)}</button></>:<span className="quiet-hint">走近物件，发现一点小乐趣 <Sparkles size={15}/></span>}</div>}
      {isPiano&&<section className="piano-panel"><div className="piano-panel-header"><div><Piano size={22}/><span><strong>来一段你的旋律</strong><small>小屋里的每个人都能听见 · 演奏时本人麦克风关闭</small></span></div><div className="piano-tools"><button onClick={()=>{clearNotes();setOctave(Math.max(21,(Math.ceil(octave/12)-1)*12));}} aria-label="降低八度">−</button><span>{octave===21?'A0':'C'+(Math.floor(octave/12)-1)}</span><button onClick={()=>{clearNotes();setOctave(Math.min(96,(Math.floor(octave/12)+1)*12));}} aria-label="升高八度">＋</button><button className={pedal?'pedal active':'pedal'} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);setSustain(true,'pointer:'+e.pointerId);}} onPointerUp={e=>setSustain(false,'pointer:'+e.pointerId)} onPointerCancel={e=>setSustain(false,'pointer:'+e.pointerId)}>延音 <kbd>空格</kbd></button><button className="text-button" onClick={()=>void release()}><X size={16}/>结束演奏</button></div></div><div className="keyboard" aria-label="钢琴键盘">{Array.from({length:visibleKeys},(_,i)=>{const note=octave+i,black=BLACK.has(note%12),whiteBefore=Array.from({length:i},(_,n)=>n).filter(n=>!BLACK.has((octave+n)%12)).length;return <button key={note} aria-label={`琴键 ${note}`} className={'piano-key '+(black?'black':'white')+(pressed.has(note)?' pressed':'')} style={black?{left:`calc(${whiteBefore/whiteKeys*100}% - ${.315/whiteKeys*100}%)`,width:`${.63/whiteKeys*100}%`}:undefined} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);noteOn(note,'pointer:'+e.pointerId);}} onPointerUp={e=>noteOff(note,'pointer:'+e.pointerId)} onPointerCancel={e=>noteOff(note,'pointer:'+e.pointerId)}><span>{KEY_NAMES[i]??''}</span>{note%12===0&&<small>C{Math.floor(note/12)-1}</small>}</button>;})}</div></section>}
      <button className="party-entry" aria-label="派对游戏" aria-expanded={panel==='party'} onClick={()=>togglePanel('party')}><Gamepad2 size={19}/><span>派对游戏</span>{partyPlaying?<small>进行中</small>:state?.minigame?.phase==='lobby'&&state.minigame.participants.length>0?<small>{state.minigame.participants.length}/6</small>:null}</button>
      {state&&panel!=='party'&&<PartyStatus state={state} self={self} connected={connected} onOpen={()=>togglePanel('party')} onChair={gameChair}/>}
      {state&&panel==='party'&&<PartyGames state={state} self={self} connected={connected} onAction={partyAction} onClose={()=>setPanel(null)}/>}
      <nav className="room-dock" aria-label="房间工具栏"><button aria-label={isPiano?'演奏中 · 麦克风关闭':mic==='requesting'?'取消开麦':mic==='on'?'麦克风已开启':'开启麦克风'} className={'mic-button '+(mic==='on'?'mic-on':'')} disabled={isPiano||!connected} onClick={()=>{if(mic==='off')void voice.current?.enable();else voice.current?.disable();}}>{mic==='on'?<Mic size={20}/>:<MicOff size={20}/>}<span>{isPiano?'演奏中 · 麦克风关闭':mic==='requesting'?'取消开麦':mic==='on'?'麦克风已开启':'开启麦克风'}</span><i className={mic==='on'?'live':''}/></button>{!touchUI&&<div className="dock-divider"/>}<IconButton label="聊天" active={panel==='chat'} onClick={()=>togglePanel('chat')}><MessageCircle size={21}/></IconButton><button className={'icon-button'+(emotesOpen||me?.pose?' active':'')} aria-label="表情动作" aria-expanded={emotesOpen} disabled={!connected||isPiano||me?.mode==='conduct'} onClick={()=>{setMoreOpen(false);setPlacesOpen(false);setPanel(null);setEmotesOpen(!emotesOpen);}}><Sparkles size={21}/></button>{touchUI?<button className={'icon-button'+(moreOpen?' active':'')} aria-label="更多" aria-expanded={moreOpen} onClick={toggleMore}><MoreHorizontal size={21}/></button>:<><div className="dock-divider"/><IconButton label="更换形象" active={panel==='wardrobe'} onClick={()=>togglePanel('wardrobe')}><Palette size={21}/></IconButton><IconButton label="房间伙伴" active={panel==='people'} onClick={()=>togglePanel('people')}><Users size={21}/></IconButton><IconButton label="声音与画质" active={panel==='settings'} onClick={()=>togglePanel('settings')}><Settings2 size={21}/></IconButton><IconButton label="操作帮助" active={panel==='help'} onClick={()=>togglePanel('help')}><CircleHelp size={21}/></IconButton></>}</nav>
      {touchUI&&moreOpen&&<><button className="mobile-menu-scrim" aria-label="收起更多菜单" onClick={()=>setMoreOpen(false)}/><section className="mobile-more-panel" aria-label="更多功能"><div className="mobile-more-heading"><strong>小屋工具</strong><IconButton label="关闭更多" onClick={()=>setMoreOpen(false)}><X size={18}/></IconButton></div><div className="mobile-more-grid"><button onClick={openPlaces} disabled={!connected||me?.mode!=='walk'} title={me?.mode!=='walk'?'先退出当前互动，再前往其他地点':undefined}><Music2 size={19}/>房间地点</button><button onClick={()=>togglePanel('wardrobe')}><Palette size={19}/>更换形象</button><button onClick={()=>togglePanel('people')}><Users size={19}/>房间伙伴</button><button onClick={()=>togglePanel('settings')}><Settings2 size={19}/>声音与画质</button><button onClick={()=>{setMoreOpen(false);void copyLink();}}><Copy size={19}/>邀请朋友</button><button onClick={()=>togglePanel('help')}><CircleHelp size={19}/>操作帮助</button></div><button className="mobile-leave-button" onClick={leave}><DoorOpen size={18}/>离开房间</button></section></>}
      {panel==='chat'&&<ChatComposer onSend={sendChat} onClose={()=>setPanel(null)} disabled={!connected}/>}
      {emotesOpen&&<ActionMenu pose={me?.pose??null} onPose={value=>void pose(value)} onEmote={value=>void emote(value)} onClose={()=>setEmotesOpen(false)} disabled={!connected||isPiano||me?.mode==='conduct'}/>}
      {me?.mode==='walk'&&<TouchJoystick disabled={!connected||!!panel||mobileOverlayOpen||progress<100} onMove={(x,z)=>world.current?.setTouch(x,z)}/>}
      <div className="touch-camera-tools"><button aria-label="拉近视角" onClick={()=>world.current?.zoom(-.45)}>＋</button><button aria-label="拉远视角" onClick={()=>world.current?.zoom(.45)}>−</button></div>
      {panel&&panel!=='help'&&panel!=='chat'&&panel!=='party'&&<aside className={'side-panel '+(panel==='wardrobe'?'wardrobe-panel':'')}><div className="side-panel-title"><h2>{panel==='people'?'小屋里的伙伴':panel==='settings'?'听起来，刚刚好':'换一个心情'}</h2><IconButton label="关闭面板" onClick={()=>setPanel(null)}><X size={19}/></IconButton></div>{panel==='people'?<><p className="panel-intro">走近伙伴，听见彼此；走远，声音会渐渐变轻。</p><div className="people-list">{players.map(p=><div className="person-row" key={p.id}><span className={'person-dot'+(speaking.has(p.id)?' speaking':'')} style={{background:p.avatar.shirtColor}}>{p.name.slice(0,1)}</span><div><b>{p.name}{p.id===self?'（你）':''}</b><small>{p.mode==='piano'?'正在弹琴':p.mode==='sit'?'坐着听听':p.mode==='conduct'?'正在指挥':speaking.has(p.id)?'正在说话':'在小屋闲逛'}</small></div>{p.id===self?(p.mic?<Mic size={16}/>:<MicOff size={16}/>):<IconButton label={(muted.has(p.id)?'取消静音 ':'静音 ')+p.name} onClick={()=>{const next=new Set(muted);if(next.has(p.id))next.delete(p.id);else next.add(p.id);setMuted(next);voice.current?.mute(p.id,next.has(p.id));}}>{muted.has(p.id)?<VolumeX size={17}/>:<Volume2 size={17}/>}</IconButton>}</div>)}</div></>:panel==='settings'?<div className="settings-content"><label><span><Piano size={18}/>琴声、节拍与游戏音乐<b>{Math.round(pianoVolume*100)}%</b></span><input aria-label="琴声音量" type="range" min={0} max={1} step={.01} value={pianoVolume} onChange={e=>{const v=Number(e.target.value);setPianoVolume(v);piano.current?.setVolume(v);}}/></label><label><span><Mic size={18}/>伙伴的声音<b>{Math.round(voiceVolume*100)}%</b></span><input aria-label="语音音量" type="range" min={0} max={1} step={.01} value={voiceVolume} onChange={e=>{const v=Number(e.target.value);setVoiceVolume(v);voice.current?.setVolume(v);}}/></label><p className="voice-range-note">近距离语音 · 1.5 米内清晰，9 米外静音。左右声音随视角变化。</p><details className="mic-tuning"><summary>麦克风灵敏度</summary><label><span>过滤环境底噪<b>{micSensitivity}%</b></span><input aria-label="麦克风灵敏度" type="range" min={0} max={100} value={micSensitivity} onChange={e=>{const v=Number(e.target.value);setMicSensitivity(v);voice.current?.setNoiseGateThreshold(-30-v*.3);}}/><small>底噪明显可调低；轻声或句尾听不清可调高。</small></label></details><button className="soft-button" onClick={()=>{void piano.current?.resume();void voice.current?.resume();notify('声音已开启');}}><Volume2 size={18}/>开启声音</button><div className="setting-divider"/><label className="quality-setting"><span>画质模式</span><select aria-label="画质模式" value={qualityMode} onChange={e=>setQualityMode(parseQualityMode(e.target.value))}><option value="auto">自动</option><option value="standard">标准</option><option value="smooth">流畅</option></select><small>{qualityMode==='auto'?`根据运行流畅度调整 · 当前${lowQuality?'流畅':'标准'}`:qualityMode==='smooth'?'降低阴影和分辨率，让操作更轻快':'保留完整阴影和画面细节'}</small></label><p className="soft-note"><Headphones size={18}/>戴耳机能让大家听得更清楚，也能减少回声。</p></div>:<><div className="wardrobe-preview"><AvatarPreview lowQuality={lowQuality} config={avatar}/></div><AvatarEditor config={avatar} onChange={changeAvatar}/><button className="primary-button full" onClick={()=>setPanel(null)}><Check size={17}/>就穿这身</button></>}</aside>}
    </div>}
    {panel==='help'&&<div className="modal-backdrop" onClick={()=>setPanel(null)}><section className="help-modal" onClick={e=>e.stopPropagation()}><div className="side-panel-title"><h2>小屋使用说明</h2><IconButton label="关闭帮助" onClick={()=>setPanel(null)}><X size={20}/></IconButton></div><p>没有标准答案，开心就好。</p><div className="help-grid"><div><span>01</span><h3>随便逛逛</h3><p>电脑用 WASD 移动、Shift 加快；手机用左侧摇杆移动，滑动画面看四周，双指缩放。也可以点地面走过去。</p></div><div><span>02</span><h3>找个位置</h3><p>点击椅子、钢琴或指挥台，角色会走近。电脑按 E 互动、Esc 退出；手机点屏幕上的互动或起身按钮。每个位置同时容纳一位伙伴。</p></div><div><span>03</span><h3>让音乐发生</h3><p>钢琴支持鼠标、触屏和键盘。空格控制延音。指挥台支持二拍、三拍、四拍，以及起拍、收拍、渐强和渐弱手势。</p></div><div><span>04</span><h3>打开话匣子</h3><p>点击聊天或按 Enter 可以发送文字和表情，并装扮自己的气泡。动作菜单中的合唱姿势再次点击即可放下。点击开麦后，附近伙伴能听见你，声音随距离和方位变化。1.5 米内清晰，9 米外听不见；钢琴仍全屋播放。弹琴时本人自动关麦，结束后可手动再开。</p></div></div><button className="primary-button full" onClick={()=>setPanel(null)}>知道啦，去玩吧<ArrowRight size={17}/></button></section></div>}
    {toast&&<div className="toast" role="status"><span>{toast}</span><button aria-label="关闭提示" onClick={()=>setToast('')}><X size={16}/></button></div>}
  </>;
}
