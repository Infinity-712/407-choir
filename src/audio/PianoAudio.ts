import type { PianoEvent } from '../../shared/protocol';

type Voice={gain:GainNode;osc:OscillatorNode[];released:boolean;timer:ReturnType<typeof setTimeout>};
export class PianoAudio {
  context:AudioContext;
  private output:GainNode;
  private voices=new Map<string,Voice>();
  private sustain=new Set<string>();
  private held=new Set<string>();
  private known=new Set<string>();
  constructor(){
    this.context=new AudioContext(); this.output=this.context.createGain(); this.output.gain.value=.65;
    const compressor=this.context.createDynamicsCompressor();compressor.threshold.value=-14;compressor.ratio.value=5;
    this.output.connect(compressor);compressor.connect(this.context.destination);
    const reverb=this.context.createConvolver(),wet=this.context.createGain();wet.gain.value=.12;
    const buffer=this.context.createBuffer(2,this.context.sampleRate*1.4,this.context.sampleRate);
    for(let c=0;c<2;c++){const samples=buffer.getChannelData(c);for(let i=0;i<samples.length;i++)samples[i]=(Math.random()*2-1)*Math.pow(1-i/samples.length,3);}
    reverb.buffer=buffer;this.output.connect(reverb);reverb.connect(wet);wet.connect(compressor);
  }
  async resume(){if(this.context.state==='suspended')await this.context.resume();}
  setVolume(value:number){this.output.gain.setTargetAtTime(Math.max(0,Math.min(1,value)),this.context.currentTime,.04);}
  event(e:PianoEvent,owner=e.playerId??'local'){
    if(e.kind==='clear'){this.clear(owner);return;}
    if(e.kind==='sustain'){
      if(e.down)this.sustain.add(owner);else{this.sustain.delete(owner);for(const key of this.known)if(key.startsWith(owner+':')&&!this.held.has(key)){this.release(key);this.known.delete(key);}}return;
    }
    if(e.midi===undefined)return;const key=owner+':'+e.midi;
    if(e.kind==='off'){this.held.delete(key);if(!this.sustain.has(owner)){this.release(key);this.known.delete(key);}return;}
    this.release(key,.025);this.held.add(key);this.known.add(key);
    if(this.voices.size>96)this.release(this.voices.keys().next().value!, .02);
    const ctx=this.context,t=ctx.currentTime,frequency=440*2**((e.midi-69)/12),g=ctx.createGain();
    const velocity=Math.max(.15,Math.min(1,e.velocity??.75));g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.12*velocity,t+.006);g.gain.exponentialRampToValueAtTime(.045*velocity,t+.2);g.gain.exponentialRampToValueAtTime(.0001,t+8);
    g.connect(this.output);const oscillators:OscillatorNode[]=[];
    [1,2,3,4,6].forEach((partial,i)=>{const osc=ctx.createOscillator(),amp=ctx.createGain();osc.type='sine';osc.frequency.value=frequency*partial*(1+.00015*partial*partial);amp.gain.setValueAtTime([1,.35,.14,.065,.018][i],t);amp.gain.exponentialRampToValueAtTime(.0001,t+[8,3,1.3,.65,.2][i]);osc.connect(amp);amp.connect(g);osc.start();osc.stop(t+8.1);oscillators.push(osc);});
    const voice:Voice={gain:g,osc:oscillators,released:false,timer:setTimeout(()=>{if(this.voices.get(key)===voice){this.voices.delete(key);this.held.delete(key);}g.disconnect();},8200)};
    this.voices.set(key,voice);
  }
  private release(key:string,duration=.17){const v=this.voices.get(key);if(!v)return;this.voices.delete(key);clearTimeout(v.timer);const t=this.context.currentTime;v.gain.gain.cancelAndHoldAtTime(t);v.gain.gain.exponentialRampToValueAtTime(.0001,t+duration);for(const o of v.osc){try{o.stop(t+duration+.02);}catch{}}setTimeout(()=>v.gain.disconnect(),(duration+.05)*1000);}
  syncNotes(owner:string,notes:number[],pedal:boolean){if(pedal)this.sustain.add(owner);else this.sustain.delete(owner);const expected=new Set(notes.map(n=>owner+':'+n));for(const key of this.known)if(key.startsWith(owner+':')&&!expected.has(key)){this.release(key);this.held.delete(key);this.known.delete(key);}for(const note of notes)if(!this.known.has(owner+':'+note))this.event({kind:'on',midi:note,velocity:.5},owner);}
  clear(owner?:string){for(const key of [...this.voices.keys()])if(!owner||key.startsWith(owner+':'))this.release(key,.05);for(const key of [...this.held])if(!owner||key.startsWith(owner+':'))this.held.delete(key);for(const key of [...this.known])if(!owner||key.startsWith(owner+':'))this.known.delete(key);if(owner)this.sustain.delete(owner);else this.sustain.clear();}
  tick(accent=false,when?:number){const t=Math.max(this.context.currentTime,when??this.context.currentTime),o=this.context.createOscillator(),g=this.context.createGain();o.frequency.value=accent?1000:720;g.gain.setValueAtTime(.055,t);g.gain.exponentialRampToValueAtTime(.0001,t+.055);o.connect(g);g.connect(this.output);o.start(t);o.stop(t+.06);o.onended=()=>g.disconnect();}
  dispose(){this.clear();void this.context.close();}
}
