import * as THREE from 'three';
import {isMusicalChairsActive,type MusicalChairsState} from '../../shared/minigames.ts';
import type {InteractionAsset} from '../../shared/protocol.ts';

const conductorMeshes=new Set([
  'Room_Web Lectern light ash top','Room_Web Lectern satin white enamel',
  'Room_Web Conductor stool black steel','Room_Web Conductor stool black upholstery',
  'Room_Web Conductor stool bolts','Room_Web Conductor stool molded back shell','Room_Web Conductor stool rubber grips',
]);
const sanitizedConductorMeshes=new Set([...conductorMeshes].map(name=>THREE.PropertyBinding.sanitizeNodeName(name)));

export function partyBadge(game:MusicalChairsState|null|undefined,id:string):{text:string;kind:string}|null{
  if(!game)return null;
  if(game.singerId===id)return {text:'🎤 被选唱歌',kind:'singer'};
  if(game.winnerId===id)return {text:'🏆 冠军',kind:'winner'};
  if(game.eliminated.includes(id))return {text:'观战 · 已淘汰',kind:'eliminated'};
  if(game.participants.includes(id))return {text:'抢凳子 · 参与',kind:'participant'};
  return null;
}

/** Temporary furniture owns every geometry and material it creates. */
export class PartyScene{
  readonly group=new THREE.Group();
  private signature='';
  private active=false;
  private imported=new Map<THREE.Object3D,boolean>();
  constructor(){this.group.name='musical-chairs-furniture';}
  setRoom(room:THREE.Object3D){
    this.restoreRoom();this.imported.clear();
    room.traverse(node=>{
      // GLTFLoader sanitizes node.name but retains the authored name in userData.
      if(conductorMeshes.has(node.userData.name)||conductorMeshes.has(node.name)||sanitizedConductorMeshes.has(node.name))this.imported.set(node,node.visible);
    });
    this.applyVisibility();
  }
  setState(game:MusicalChairsState|null|undefined):boolean{
    this.active=isMusicalChairsActive(game);this.applyVisibility();
    const chairs=this.active?game!.chairs:[];
    const signature=JSON.stringify(chairs.map(chair=>[chair.id,chair.position,chair.rotation]));
    if(signature===this.signature)return false;
    this.signature=signature;this.clear();
    for(const chair of chairs)this.group.add(this.createChair(chair));
    return true;
  }
  private applyVisibility(){for(const [node,visible] of this.imported)node.visible=this.active?false:visible;}
  private restoreRoom(){for(const [node,visible] of this.imported)node.visible=visible;}
  private createChair(asset:InteractionAsset):THREE.Group{
    const chair=new THREE.Group();chair.name=asset.id;chair.position.set(asset.position[0],0,asset.position[2]);chair.rotation.y=asset.rotation;
    const metal=new THREE.MeshStandardMaterial({color:'#7e8994',metalness:.8,roughness:.27});
    const dark=new THREE.MeshStandardMaterial({color:'#262831',roughness:.88});
    const purple=new THREE.MeshStandardMaterial({color:'#9b80ce',roughness:.85});
    const add=(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,name?:string)=>{
      const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.name=name??'party-chair-frame';mesh.castShadow=true;mesh.receiveShadow=true;chair.add(mesh);return mesh;
    };
    add(new THREE.BoxGeometry(.45,.06,.4),purple,0,.4475,0,'party-chair-seat');
    add(new THREE.BoxGeometry(.45,.36,.04),dark,0,.72,-.2,'party-chair-back');
    for(const x of [-.207,.207])for(const z of [-.184,.184]){
      const rear=z<0,height=rear?.84:.415;
      add(new THREE.CylinderGeometry(.014,.014,height,8),metal,x,height/2,z);
      add(new THREE.CylinderGeometry(.02,.02,.015,8),dark,x,.0075,z,'party-chair-foot');
    }
    for(const z of [-.17,.17]){const rail=add(new THREE.CylinderGeometry(.013,.013,.414,8),metal,0,.4,z);rail.rotation.z=Math.PI/2;}
    return chair;
  }
  private clear(){
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
    this.group.traverse(node=>{if(node instanceof THREE.Mesh){geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])materials.add(material);}});
    this.group.clear();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
  }
  dispose(){this.clear();this.restoreRoom();this.imported.clear();this.group.removeFromParent();}
}
