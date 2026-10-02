export type RenderQualityMode='auto'|'standard'|'smooth';
export type EffectiveQuality='standard'|'smooth';
export const parseQualityMode=(value:unknown):RenderQualityMode=>value==='standard'||value==='smooth'?value:'auto';

/** Frame-time feedback uses sustained windows, never one loading spike. */
export class AdaptiveRenderQuality {
  private mode:RenderQualityMode='auto';
  private level:number;
  private warmup=0;private elapsed=0;private frames=0;private fast=0;private cooldown=0;
  constructor(private deviceRatio=1,private coarse=false){this.level=coarse?1:0;}
  get current(){return {mode:this.mode,effective:(this.level===0?'standard':'smooth') as EffectiveQuality,pixelRatio:Math.min(Math.max(.5,this.deviceRatio),[1.5,1,.8,.65][this.level])};}
  setMode(mode:RenderQualityMode){this.mode=mode;this.level=mode==='standard'?0:mode==='smooth'||this.coarse?1:0;this.reset();this.cooldown=0;return this.current;}
  private reset(){this.warmup=0;this.elapsed=0;this.frames=0;this.fast=0;}
  sample(ms:number,active:boolean){
    if(!active||!Number.isFinite(ms)||ms<=0||ms>1000){this.reset();return false;}
    if(this.mode==='standard')return false;
    this.warmup+=ms;this.cooldown=Math.max(0,this.cooldown-ms);
    if(this.warmup<3000)return false;
    this.elapsed+=ms;this.frames++;
    if(this.elapsed<2000)return false;
    const mean=this.elapsed/this.frames,duration=this.elapsed;this.elapsed=0;this.frames=0;
    this.fast=mean<17?this.fast+duration:0;
    let next=this.level;
    if(mean>26&&this.cooldown===0)next=Math.min(3,this.level+1);
    else if(this.fast>=20000&&this.cooldown===0)next=Math.max(this.mode==='smooth'||this.coarse?1:0,this.level-1);
    if(next===this.level)return false;
    this.level=next;this.cooldown=6000;this.fast=0;return true;
  }
}
