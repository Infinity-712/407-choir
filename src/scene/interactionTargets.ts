import * as THREE from 'three';
import type { InteractionAsset } from '../../shared/protocol';

/** Picking follows the visible furniture, independently of the avatar's seat anchor. */
export function interactionTargets(assets:InteractionAsset[]):THREE.Mesh[]{
  return assets.flatMap(asset=>{
    const boxes=asset.hitBoxes??[{min:[asset.position[0]-.285,asset.position[1]-.2,asset.position[2]-.325],max:[asset.position[0]+.285,asset.position[1]+.8,asset.position[2]+.325]}];
    return boxes.map(({min,max})=>{
      const size=new THREE.Vector3(max[0]-min[0],max[1]-min[1],max[2]-min[2]);
      const hit=new THREE.Mesh(new THREE.BoxGeometry(size.x,size.y,size.z),new THREE.MeshBasicMaterial({visible:false}));
      hit.position.set((min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2);
      hit.userData.asset=asset;hit.visible=false;return hit;
    });
  });
}
