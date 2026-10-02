import {MeshoptSimplifier} from 'meshoptimizer';

export type VertexAttributes={values:Float32Array;stride:number};

// Exporters may assign a new vertex to every face corner. Reconnect only corners
// whose entire attribute tuple matches; positions alone would erase UV/normal seams.
function reconnectCorners(indices:Uint32Array,positions:Float32Array,attributes?:VertexAttributes){
  const p=new Uint32Array(positions.buffer,positions.byteOffset,positions.length);
  const a=attributes&&new Uint32Array(attributes.values.buffer,attributes.values.byteOffset,attributes.values.length);
  const stride=attributes?.stride??0,count=positions.length/3;
  let capacity=1;while(capacity<count*2)capacity*=2;
  const table=new Uint32Array(capacity),remap=new Uint32Array(count),seen=new Uint8Array(count);
  const same=(left:number,right:number)=>{
    for(let j=0;j<3;j++)if(p[left*3+j]!==p[right*3+j])return false;
    for(let j=0;j<stride;j++)if(a![left*stride+j]!==a![right*stride+j])return false;
    return true;
  };
  for(const index of indices){
    if(seen[index])continue;
    seen[index]=1;
    let hash=2166136261;
    for(let j=0;j<3;j++)hash=Math.imul(hash^p[index*3+j],16777619);
    for(let j=0;j<stride;j++)hash=Math.imul(hash^a![index*stride+j],16777619);
    let slot=(hash^(hash>>>16))&(capacity-1);
    while(table[slot]&&!same(index,table[slot]-1))slot=(slot+1)&(capacity-1);
    if(!table[slot])table[slot]=index+1;
    remap[index]=table[slot]-1;
  }
  return indices.map(index=>remap[index]);
}

/** Index-only LOD: vertex attributes stay byte-for-byte identical. */
export async function simplifyRoomGeometry(indices:Uint32Array,positions:Float32Array,worldScale:number,attributes?:VertexAttributes){
  if(!Number.isFinite(worldScale)||worldScale<=0)throw new Error('Invalid geometry world scale');
  await MeshoptSimplifier.ready;
  if(!MeshoptSimplifier.supported)throw new Error('Mesh simplification is unavailable');
  const connected=reconnectCorners(indices,positions,attributes);
  const [simplified,error]=MeshoptSimplifier.simplify(connected,positions,3,
    Math.max(3,Math.floor(indices.length*0.35/3)*3),0.0015/worldScale,['LockBorder','ErrorAbsolute','Sparse']);
  return {indices:simplified,worldError:error*worldScale};
}
