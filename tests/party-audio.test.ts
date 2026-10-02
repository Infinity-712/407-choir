import test from 'node:test';
import assert from 'node:assert/strict';
import {PartyAudio} from '../src/audio/PartyAudio.ts';
import type {MusicalChairsState} from '../shared/minigames.ts';

function fixture(t:import('node:test').TestContext){
  t.mock.timers.enable({apis:['setInterval','Date'],now:1000});
  const sources:{start:(at:number)=>void;stop:(at?:number)=>void;connect:()=>void;disconnect:()=>void;onended:(()=>void)|null;frequency:any;type:string;buffer:unknown;starts:number[];stops:number[];disconnected:boolean}[]=[];
  const param=()=>({value:0,setValueAtTime(){},setTargetAtTime(){},exponentialRampToValueAtTime(){}});
  const nodes:{gain:any;connect:()=>void;disconnect:()=>void;disconnected:boolean}[]=[];
  const ctx={currentTime:0,sampleRate:8000,state:'running',destination:{},closeCalls:0,close(){this.closeCalls++;},createGain(){const n={gain:param(),connect(){},disconnect(){this.disconnected=true;},disconnected:false};nodes.push(n);return n;},createBuffer(_c:number,length:number){return {getChannelData(){return new Float32Array(length);}};},createOscillator(){return source();},createBufferSource(){return source();}};
  const source=()=>{const s={frequency:param(),type:'',buffer:null as unknown,onended:null as (()=>void)|null,starts:[] as number[],stops:[] as number[],disconnected:false,start(at:number){this.starts.push(at);},stop(at=ctx.currentTime){this.stops.push(at);},connect(){},disconnect(){this.disconnected=true;}};sources.push(s);return s;};
  const audio=new PartyAudio(ctx as unknown as AudioContext);t.after(()=>audio.dispose());
  const game={kind:'musical-chairs',gameId:'a',phase:'music',phaseStartedAt:1000,musicVariant:0} as MusicalChairsState;
  return {audio,ctx,sources,nodes,game};
}
test('drums follow authoritative music phase and snapshots do not start duplicate loops',t=>{
  const h=fixture(t);h.audio.sync(null,1000);assert.equal(h.sources.length,0);
  h.audio.sync(h.game,1000);assert.ok(h.sources.length>0);const first=h.sources.length;
  h.audio.sync(h.game,1000);assert.equal(h.sources.length,first);
  h.ctx.currentTime=.5;t.mock.timers.tick(500);assert.ok(h.sources.length>first);
  h.audio.sync({...h.game,phase:'scramble'},1500);
  assert.ok(h.sources.every(s=>s.disconnected&&s.stops.some(at=>at<=h.ctx.currentTime)));
  const stopped=h.sources.length;t.mock.timers.tick(1000);assert.equal(h.sources.length,stopped);
});
test('exit and disposal cancel scheduled drums without closing the shared voice/piano context',t=>{
  const h=fixture(t);h.audio.setVolume(0);h.audio.sync(h.game,1000);h.audio.sync(null,1000);
  assert.ok(h.sources.every(s=>s.disconnected));h.audio.sync({...h.game,gameId:'new'},1000);h.audio.dispose();
  const count=h.sources.length;t.mock.timers.tick(2000);h.audio.sync(h.game,3000);assert.equal(h.sources.length,count);assert.equal(h.ctx.closeCalls,0);assert.ok(h.nodes.every(n=>n.disconnected));
});
