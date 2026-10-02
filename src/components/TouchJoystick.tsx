import {useEffect,useRef,useState,type PointerEvent} from 'react';

export function TouchJoystick({onMove,disabled=false}:{onMove:(x:number,z:number)=>void;disabled?:boolean}){
  const pointer=useRef<number|null>(null),callback=useRef(onMove);callback.current=onMove;
  const [knob,setKnob]=useState({x:0,y:0});
  const reset=()=>{pointer.current=null;setKnob({x:0,y:0});callback.current(0,0);};
  useEffect(()=>{
    const cancel=()=>reset();window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);document.addEventListener('visibilitychange',cancel);
    return()=>{window.removeEventListener('blur',cancel);window.removeEventListener('resize',cancel);document.removeEventListener('visibilitychange',cancel);callback.current(0,0);};
  },[]);
  useEffect(()=>{if(disabled)reset();},[disabled]);
  const move=(e:PointerEvent<HTMLButtonElement>)=>{
    if(disabled||pointer.current!==e.pointerId)return;
    const rect=e.currentTarget.getBoundingClientRect(),radius=rect.width*.3;
    const dx=e.clientX-rect.left-rect.width/2,dy=e.clientY-rect.top-rect.height/2;
    const distance=Math.hypot(dx,dy),scale=distance>radius?radius/distance:1;
    const x=dx*scale,y=dy*scale;setKnob({x,y});
    if(distance<radius*.12)callback.current(0,0);else callback.current(x/radius,y/radius);
  };
  return <div className="touch-controls">
    <button className="touch-joystick" type="button" aria-label="移动摇杆" disabled={disabled}
      onPointerDown={e=>{if(disabled||pointer.current!==null)return;e.preventDefault();pointer.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);move(e);}}
      onPointerMove={move} onPointerUp={e=>{if(e.pointerId===pointer.current)reset();}}
      onPointerCancel={e=>{if(e.pointerId===pointer.current)reset();}} onLostPointerCapture={e=>{if(e.pointerId===pointer.current)reset();}}>
      <span className="joystick-cross" aria-hidden="true"/>
      <span className="joystick-knob" style={{transform:`translate(${knob.x}px,${knob.y}px)`}} aria-hidden="true"/>
    </button>
    <span className="touch-control-caption">拖动移动 · 右侧滑动看四周</span>
  </div>;
}
