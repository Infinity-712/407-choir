import type {MusicalChairsState} from '../../shared/minigames';

/** Temporary, self-made drum loops. A future music asset can replace this source. */
export class PartyAudio {
  private output:GainNode;
  private timer?:ReturnType<typeof setInterval>;
  private sources=new Map<AudioScheduledSourceNode,GainNode>();
  private game:MusicalChairsState|null=null;
  private identity='';private lastBeat=-1;private offset=0;private disposed=false;
  private noise:AudioBuffer;
  constructor(private context:AudioContext){
    this.output=context.createGain();this.output.gain.value=.65;this.output.connect(context.destination);
    this.noise=context.createBuffer(1,Math.floor(context.sampleRate*.08),context.sampleRate);
    const samples=this.noise.getChannelData(0);
    for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*(1-i/samples.length);
  }
  setVolume(value:number){if(!this.disposed&&Number.isFinite(value))this.output.gain.setTargetAtTime(Math.max(0,Math.min(1,value)),this.context.currentTime,.03);}
  sync(game:MusicalChairsState|null|undefined,serverTime:number){
    if(this.disposed)return;
    this.offset=serverTime-Date.now();
    if(!game||game.phase!=='music'){this.stop();return;}
    this.game=game;
    const identity=`${game.gameId}:${game.round}:${game.phaseStartedAt}`;
    if(identity===this.identity)return;
    this.stop();this.game=game;this.identity=identity;
    this.schedule();this.timer=setInterval(()=>this.schedule(),25);
  }
  private schedule(){
    if(!this.game||this.context.state==='suspended')return;
    const elapsed=Date.now()+this.offset-this.game.phaseStartedAt;
    const beat=Math.floor(Math.max(0,elapsed)/250);
    if(beat<=this.lastBeat)return;
    this.lastBeat=beat;
    const when=this.context.currentTime;
    const pattern=this.game.musicVariant%3;
    if(beat%4===0||(pattern===1&&beat%8===6))this.kick(when);
    if(beat%4===2)this.percussion(when,.042,.07);
    if(beat%2===0||pattern===2)this.percussion(when,.012,.03);
  }
  private own(source:AudioScheduledSourceNode,gain:GainNode,at:number,duration:number){
    source.connect(gain);gain.connect(this.output);this.sources.set(source,gain);
    source.onended=()=>{source.disconnect();gain.disconnect();this.sources.delete(source);};
    source.start(at);source.stop(at+duration);
  }
  private kick(at:number){
    const osc=this.context.createOscillator(),gain=this.context.createGain();osc.type='sine';
    osc.frequency.setValueAtTime(130,at);osc.frequency.exponentialRampToValueAtTime(48,at+.12);
    gain.gain.setValueAtTime(.105,at);gain.gain.exponentialRampToValueAtTime(.0001,at+.17);
    this.own(osc,gain,at,.18);
  }
  private percussion(at:number,volume:number,duration:number){
    const noise=this.context.createBufferSource(),gain=this.context.createGain();noise.buffer=this.noise;
    gain.gain.setValueAtTime(volume,at);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    this.own(noise,gain,at,duration+.005);
  }
  private stop(){
    clearInterval(this.timer);this.timer=undefined;this.game=null;this.identity='';this.lastBeat=-1;
    for(const [source,gain]of this.sources){source.onended=null;try{source.stop();}catch{/* Already ended. */}source.disconnect();gain.disconnect();}
    this.sources.clear();
  }
  dispose(){if(this.disposed)return;this.stop();this.disposed=true;this.output.disconnect();}
}
