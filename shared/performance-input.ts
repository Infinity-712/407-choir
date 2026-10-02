/** A note is down while at least one physical input source still holds it. */
export class PerformanceInput {
  private held=new Map<number,Set<string>>();
  private pedals=new Set<string>();
  press(midi:number,source:string):boolean{let sources=this.held.get(midi);const first=!sources;if(!sources){sources=new Set();this.held.set(midi,sources);}sources.add(source);return first;}
  release(midi:number,source:string):boolean{const sources=this.held.get(midi);if(!sources||!sources.delete(source))return false;if(sources.size)return false;this.held.delete(midi);return true;}
  notes(){return [...this.held.keys()];}
  pedal(down:boolean,source:string):boolean{const previous=this.pedals.size>0;if(down)this.pedals.add(source);else this.pedals.delete(source);return previous!==(this.pedals.size>0);}
  isSustained(){return this.pedals.size>0;}
  clear(){this.held.clear();this.pedals.clear();}
}
