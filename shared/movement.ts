import type { Footprint, RoomLayout, Vec3 } from './protocol.ts';

function polygonContains(points:Footprint,x:number,z:number):boolean {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i],b=points[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function edgeDistance(points:Footprint,x:number,z:number):number {
  let distance=Infinity;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    distance=Math.min(distance,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
  }
  return distance;
}
export function withinRoom(layout:RoomLayout,x:number,z:number,radius=.18):boolean {
  const b=layout.bounds;
  if(!Number.isFinite(x)||!Number.isFinite(z)||x<b.minX+radius||x>b.maxX-radius||z<b.minZ+radius||z>b.maxZ-radius) return false;
  return !layout.footprint || (polygonContains(layout.footprint,x,z)&&edgeDistance(layout.footprint,x,z)>=radius-1e-9);
}
/** Keep the camera along the view from an interior anchor without crossing a room wall. */
export function constrainRoomPosition(layout:RoomLayout,from:Vec3,to:Vec3,radius=.15):Vec3 {
  const b=layout.bounds;
  const target:Vec3=[Math.max(b.minX+radius,Math.min(b.maxX-radius,to[0])),to[1],Math.max(b.minZ+radius,Math.min(b.maxZ-radius,to[2]))];
  if(!layout.footprint)return target;
  if(!withinRoom(layout,from[0],from[2],radius))return [from[0],to[1],from[2]];
  // Sampling also catches a segment leaving and reentering a concave room.
  const steps=Math.max(1,Math.ceil(Math.hypot(target[0]-from[0],target[2]-from[2])/.05));
  const at=(t:number):Vec3=>[from[0]+(target[0]-from[0])*t,to[1],from[2]+(target[2]-from[2])*t];
  for(let i=1;i<=steps;i++) {
    const p=at(i/steps);
    if(withinRoom(layout,p[0],p[2],radius))continue;
    let lo=(i-1)/steps,hi=i/steps;
    for(let j=0;j<24;j++){const mid=(lo+hi)/2,q=at(mid);if(withinRoom(layout,q[0],q[2],radius))lo=mid;else hi=mid;}
    return at(lo);
  }
  return target;
}

export function groundHeight(layout:RoomLayout,x:number,z:number):number {
  let h=0; for(const f of layout.floors) if(x>=f.min[0]&&x<=f.max[0]&&z>=f.min[1]&&z<=f.max[1]) h=Math.max(h,f.height); return h;
}
export function canStand(layout:RoomLayout,x:number,z:number,radius=.18):boolean {
  if(!withinRoom(layout,x,z,radius))return false;
  const floor=groundHeight(layout,x,z);
  return !layout.colliders.some(c=>{
    if((c.maxY!==undefined&&c.maxY<=floor+.04)||(c.minY!==undefined&&c.minY>=floor+1.4))return false;
    if(!(x>c.min[0]-radius&&x<c.max[0]+radius&&z>c.min[1]-radius&&z<c.max[1]+radius))return false;
    return !c.footprint||polygonContains(c.footprint,x,z)||edgeDistance(c.footprint,x,z)<radius-1e-9;
  });
}
export function stepPosition(layout:RoomLayout,from:Vec3,to:Vec3,radius=.18):Vec3 {
  let [x,,z]=from;
  const n=Math.max(1,Math.ceil(Math.hypot(to[0]-x,to[2]-z)/.08));
  const dx=(to[0]-x)/n,dz=(to[2]-z)/n;
  for(let i=0;i<n;i++) {
    if(canStand(layout,x+dx,z,radius)&&groundHeight(layout,x+dx,z)-groundHeight(layout,x,z)<.4) x+=dx;
    if(canStand(layout,x,z+dz,radius)&&groundHeight(layout,x,z+dz)-groundHeight(layout,x,z)<.4) z+=dz;
  }
  return [x,groundHeight(layout,x,z),z];
}
export function findPath(layout:RoomLayout,from:Vec3,to:Vec3):Vec3[] {
  const cell=.22,b=layout.bounds;
  // Retain the coarse room grid, but include real approach lanes. A clear aisle
  // between chair rows can be narrower than one cell without being impassable.
  const axis=(min:number,max:number,values:number[])=>[...new Set([...Array.from({length:Math.ceil((max-min)/cell)+1},(_,i)=>Math.min(max,min+i*cell)),...values.filter(v=>v>=min&&v<=max)])].sort((a,b)=>a-b);
  const xs=axis(b.minX,b.maxX,[from[0],to[0],...layout.assets.map(a=>a.approach[0])]),zs=axis(b.minZ,b.maxZ,[from[2],to[2],...layout.assets.map(a=>a.approach[2])]),w=xs.length,h=zs.length;
  const positions=new Array<Vec3>(w*h),standable=new Int8Array(w*h);
  const world=(i:number):Vec3=>{if(positions[i])return positions[i];const x=xs[i%w],z=zs[Math.floor(i/w)];return positions[i]=[x,groundHeight(layout,x,z),z];};
  const closest=(values:number[],value:number)=>{let best=0;for(let i=1;i<values.length;i++)if(Math.abs(values[i]-value)<Math.abs(values[best]-value))best=i;return best;};
  const index=(p:Vec3)=>closest(xs,p[0])+closest(zs,p[2])*w;
  const valid=(i:number)=>{if(i<0||i>=w*h)return false;if(!standable[i]){const p=world(i);standable[i]=canStand(layout,p[0],p[2])?1:-1;}return standable[i]===1;};
  const nearest=(initial:number)=>{if(valid(initial))return initial;let best=-1,d=Infinity;const origin=world(initial);for(let i=0;i<w*h;i++){const p=world(i),dist=Math.hypot(p[0]-origin[0],p[2]-origin[2]);if(dist<d&&dist<1.2&&valid(i)){best=i;d=dist;}}return best;};
  const start=nearest(index(from)),end=nearest(index(to)); if(start<0||end<0)return [];
  const open=new Set([start]),g=new Map([[start,0]]),parent=new Map<number,number>(),done=new Set<number>();
  const heuristic=(i:number)=>Math.hypot(xs[i%w]-xs[end%w],zs[Math.floor(i/w)]-zs[Math.floor(end/w)]);
  for(let attempts=0;open.size&&attempts<w*h;attempts++){
    let current=-1,score=Infinity;for(const i of open){const f=g.get(i)!+heuristic(i);if(f<score){score=f;current=i;}}
    if(current===end){const out:Vec3[]=[];while(current!==start){out.unshift(world(current));current=parent.get(current)!;}return out;}
    open.delete(current);done.add(current);const cx=current%w,cz=Math.floor(current/w);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
      const nx=cx+dx,nz=cz+dz,ni=nx+nz*w;
      if(nx<0||nx>=w||nz<0||nz>=h||done.has(ni)||!valid(ni))continue;
      if(dx&&dz&&(!valid(cx+dx+cz*w)||!valid(cx+(cz+dz)*w)))continue;
      if(world(ni)[1]-world(current)[1]>.39)continue;
      // A clear endpoint can still lie across a thin edge or diagonal corner.
      // Match walking's sampled movement before admitting this directed edge.
      const reached=stepPosition(layout,world(current),world(ni)),destination=world(ni);
      if(Math.hypot(reached[0]-destination[0],reached[2]-destination[2])>1e-6)continue;
      const ng=g.get(current)!+Math.hypot(xs[nx]-xs[cx],zs[nz]-zs[cz]);if(ng<(g.get(ni)??Infinity)){parent.set(ni,current);g.set(ni,ng);open.add(ni);}
    }
  }
  return [];
}
