type Point={x:number;y:number;originX:number;originY:number};
/** One pointer orbits, two pointers zoom; ending a pinch never becomes a click. */
export class CameraGestures{
  private points=new Map<number,Point>();private moved=false;
  down(id:number,x:number,y:number){if(!this.points.size)this.moved=false;this.points.set(id,{x,y,originX:x,originY:y});if(this.points.size>1)this.moved=true;}
  move(id:number,x:number,y:number):{dx:number;dy:number;zoom:number}|null{
    const point=this.points.get(id);if(!point)return null;
    const before=[...this.points.values()];const oldDistance=before.length>1?Math.hypot(before[0].x-before[1].x,before[0].y-before[1].y):0;
    const dx=x-point.x,dy=y-point.y;point.x=x;point.y=y;
    if(this.points.size>1){const [a,b]=this.points.values();return {dx:0,dy:0,zoom:oldDistance-Math.hypot(a.x-b.x,a.y-b.y)};}
    if(Math.hypot(x-point.originX,y-point.originY)>5)this.moved=true;
    return this.moved?{dx,dy,zoom:0}:null;
  }
  up(id:number){if(!this.points.has(id))return false;const tap=!this.moved&&this.points.size===1;this.points.delete(id);return tap;}
  cancel(){this.points.clear();this.moved=false;}
  get active(){return this.points.size>0;}
}
