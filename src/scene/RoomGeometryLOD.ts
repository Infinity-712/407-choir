import * as THREE from 'three';

type Entry={geometry:THREE.BufferGeometry;original:THREE.BufferAttribute;smooth?:THREE.BufferAttribute;worldScale:number};

/** Pass the static imported room root, before adding any avatars. */
export class RoomGeometryLOD{
  private entries:Entry[]=[];
  private worker?:Worker;
  private low=false;
  private disposed=false;
  private failed=false;
  private next=0;
  private pending=false;
  readonly statistics={originalTriangles:0,smoothTriangles:0,processedMeshes:0,totalMeshes:0};

  constructor(root:THREE.Object3D,private onReady?:()=>void){
    root.updateWorldMatrix(true,true);
    const byGeometry=new Map<THREE.BufferGeometry,Entry>();
    const excluded=new Set<THREE.BufferGeometry>();
    root.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const geometry=object.geometry,index=geometry.index,position=geometry.getAttribute('position');
      let interactive=false;
      for(let ancestor:THREE.Object3D|null=object;ancestor;ancestor=ancestor.parent){
        if(ancestor.userData.midi!==undefined||ancestor.userData.pianoKeyBatch||ancestor.userData.avatar!==undefined||ancestor.userData.avatarId!==undefined)interactive=true;
        if(ancestor===root)break;
      }
      const materials=Array.isArray(object.material)?object.material:[object.material];
      if(interactive||object instanceof THREE.SkinnedMesh||object instanceof THREE.InstancedMesh||
        materials.some(material=>material.transparent)||Object.keys(geometry.morphAttributes).length||
        geometry.groups.length||geometry.drawRange.start!==0||geometry.drawRange.count!==Infinity||
        !index||index.count<3000||!position||position.itemSize!==3){excluded.add(geometry);return;}
      // Bound the largest singular value, including shear from nested nonuniform scales.
      const axes=[0,1,2].map(column=>new THREE.Vector3().setFromMatrixColumn(object.matrixWorld,column));
      const worldScale=Math.sqrt(Math.max(...axes.map(axis=>axes.reduce((sum,other)=>sum+Math.abs(axis.dot(other)),0))));
      if(!Number.isFinite(worldScale)||worldScale<=0){excluded.add(geometry);return;}
      const existing=byGeometry.get(geometry);
      if(existing)existing.worldScale=Math.max(existing.worldScale,worldScale);
      else byGeometry.set(geometry,{geometry,original:index,worldScale});
    });
    this.entries=[...byGeometry.values()].filter(entry=>!excluded.has(entry.geometry));
    this.statistics.totalMeshes=this.entries.length;
    this.statistics.originalTriangles=this.entries.reduce((sum,entry)=>sum+entry.original.count/3,0);
    this.statistics.smoothTriangles=this.statistics.originalTriangles;
  }

  setLow(low:boolean){
    if(this.disposed)return;
    this.low=low;
    for(const entry of this.entries)entry.geometry.setIndex(low&&entry.smooth?entry.smooth:entry.original);
    if(low)this.processNext();
  }

  private processNext(){
    if(!this.low||this.disposed||this.failed||this.pending||this.next>=this.entries.length)return;
    try{
      if(!this.worker){
        this.worker=new Worker(new URL('./room-lod.worker.ts',import.meta.url),{type:'module'});
        this.worker.onerror=()=>this.stopAfterFailure();
        this.worker.onmessageerror=()=>this.stopAfterFailure();
        this.worker.onmessage=(event:MessageEvent<{id:number;indices?:Uint32Array;worldError?:number;error?:boolean}>)=>{
          if(this.disposed)return;
          const data=event.data,entry=this.entries[data.id];
          this.pending=false;
          if(!entry||data.error){this.stopAfterFailure();return;}
          if(data.indices&&Number.isFinite(data.worldError)&&(data.worldError??Infinity)<=0.00150001&&data.indices.length<entry.original.count){
            entry.smooth=new THREE.BufferAttribute(data.indices,1);
            this.statistics.smoothTriangles-=(entry.original.count-data.indices.length)/3;
            if(this.low)entry.geometry.setIndex(entry.smooth);
          }
          this.statistics.processedMeshes++;
          this.onReady?.();
          this.processNext();
        };
      }
      const id=this.next++,entry=this.entries[id];
      const indices=Uint32Array.from(entry.original.array);
      const source=entry.geometry.getAttribute('position');
      const positions=new Float32Array(source.count*3);
      for(let i=0;i<source.count;i++){positions[i*3]=source.getX(i);positions[i*3+1]=source.getY(i);positions[i*3+2]=source.getZ(i);}
      const channels=Object.entries(entry.geometry.attributes).filter(([name])=>name!=='position').map(([,attribute])=>attribute);
      const stride=channels.reduce((sum,attribute)=>sum+attribute.itemSize,0);
      const values=new Float32Array(source.count*stride);
      for(let i=0;i<source.count;i++){
        let offset=i*stride;
        for(const channel of channels)for(let component=0;component<channel.itemSize;component++)values[offset++]=channel.getComponent(i,component);
      }
      this.pending=true;
      this.worker.postMessage({id,indices,positions,worldScale:entry.worldScale,attributes:{values,stride}},[indices.buffer,positions.buffer,values.buffer]);
    }catch{this.stopAfterFailure();}
  }

  private stopAfterFailure(){this.failed=true;this.pending=false;this.worker?.terminate();this.worker=undefined;}

  dispose(){
    this.disposed=true;
    this.worker?.terminate();
    this.worker=undefined;
    for(const entry of this.entries)entry.geometry.setIndex(entry.original);
    this.entries=[];
  }
}
