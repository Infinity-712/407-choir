import {simplifyRoomGeometry,type VertexAttributes} from '../../shared/simplify-room-geometry';

self.onmessage=async(event:MessageEvent<{id:number;indices:Uint32Array;positions:Float32Array;worldScale:number;attributes?:VertexAttributes}>)=>{
  const {id,indices,positions,worldScale,attributes}=event.data;
  try{
    const result=await simplifyRoomGeometry(indices,positions,worldScale,attributes);
    self.postMessage({id,...result},{transfer:[result.indices.buffer]});
  }catch{
    self.postMessage({id,error:true});
  }
};
