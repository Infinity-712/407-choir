import * as THREE from 'three';
import {COLOR_TEAMS,COLOR_WAR_RULES} from '../../shared/color-war';
import type {RoomLayout,RoomState} from '../../shared/protocol';
import {groundHeight} from '../../shared/movement';

/** Owns only its overlay group. Never modifies room or avatar materials. */
export class ColorWarEffects {
  private root=new THREE.Group();
  private state:RoomState|null=null;
  private projectiles=new Map<string,THREE.Group>();
  private splashes=new Map<string,THREE.Group>();
  private rings=new Map<string,THREE.Group>();
  private chair:THREE.Group|null=null;
  private disposed=false;
  constructor(scene:THREE.Scene,private layout:RoomLayout){this.root.name='color-war-effects';scene.add(this.root);}
  get statistics(){return{projectiles:this.projectiles.size,splashes:this.splashes.size,rings:this.rings.size};}
  private color(team:string){return COLOR_TEAMS.find(t=>t.id===team)?.color??'#ffffff';}
  private remove(group:THREE.Group){group.removeFromParent();group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material])material.dispose();}});}
  private clear(map:Map<string,THREE.Group>){for(const group of map.values())this.remove(group);map.clear();}
  private disc(color:string,radius:number){
    const group=new THREE.Group();
    for(const [r,c,y]of [[radius+.025,'#43364c',0],[radius,color,.004]] as const){const mesh=new THREE.Mesh(new THREE.RingGeometry(r*.77,r,32),new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide,transparent:true,opacity:.9,depthWrite:false}));mesh.rotation.x=-Math.PI/2;mesh.position.y=y;group.add(mesh);}
    this.root.add(group);return group;
  }
  setState(state:RoomState,_self:string){
    if(this.disposed)return;this.state=state;
    if(!state.colorWar||!['playing','countdown'].includes(state.colorWar.phase)){this.clear(this.projectiles);this.clear(this.splashes);this.clear(this.rings);if(this.chair)this.remove(this.chair);this.chair=null;}
  }
  update(now:number,positions?:ReadonlyMap<string,THREE.Vector3>){
    if(this.disposed)return;const game=this.state?.colorWar;if(!game||!['playing','countdown'].includes(game.phase))return;
    const participantIds=new Set(Object.keys(game.members));
    for(const [id,group]of this.rings)if(!participantIds.has(id)){this.remove(group);this.rings.delete(id);}
    for(const [id,member]of Object.entries(game.members)){
      const player=this.state?.players[id];if(!player)continue;
      let ring=this.rings.get(id);if(ring&&ring.userData.team!==member.team){this.remove(ring);this.rings.delete(id);ring=undefined;}
      if(!ring){ring=this.disc(this.color(member.team),.35);ring.userData.team=member.team;this.rings.set(id,ring);}
      ring.position.copy(positions?.get(id)??new THREE.Vector3(...player.position));ring.position.y=groundHeight(this.layout,ring.position.x,ring.position.z)+.035;
      ring.scale.setScalar(member.immuneUntil>now?1+.08*Math.sin(now*.015):1);
    }
    const projectiles=game.projectiles.slice(-COLOR_WAR_RULES.maxProjectiles),ids=new Set(projectiles.map(p=>p.id));
    for(const [id,group]of this.projectiles)if(!ids.has(id)){this.remove(group);this.projectiles.delete(id);}
    for(const projectile of projectiles){let group=this.projectiles.get(projectile.id);if(!group){group=new THREE.Group();const mesh=new THREE.Mesh(new THREE.SphereGeometry(.10,10,8),new THREE.MeshStandardMaterial({color:this.color(projectile.team),roughness:.24}));mesh.scale.y=1.15;group.add(mesh);this.root.add(group);this.projectiles.set(projectile.id,group);}group.position.fromArray(projectile.position);}
    const splashes=game.splashes.filter(s=>s.expiresAt>now).slice(-COLOR_WAR_RULES.maxSplashes),splashIds=new Set(splashes.map(s=>s.id));
    for(const [id,group]of this.splashes)if(!splashIds.has(id)){this.remove(group);this.splashes.delete(id);}
    for(const splash of splashes){let group=this.splashes.get(splash.id);if(!group){group=this.disc(this.color(splash.team),.29);for(let i=0;i<5;i++){const mesh=new THREE.Mesh(new THREE.SphereGeometry(.075,7,5),new THREE.MeshBasicMaterial({color:this.color(splash.team),transparent:true,opacity:.8,depthWrite:false}));mesh.position.set(Math.cos(i*2.4)*.23,.10+i*.06,Math.sin(i*2.4)*.23);group.add(mesh);}this.splashes.set(splash.id,group);}
      const target=splash.targetId?positions?.get(splash.targetId)??(this.state?.players[splash.targetId]?new THREE.Vector3(...this.state.players[splash.targetId].position):undefined):undefined;
      group.position.copy(target??new THREE.Vector3(...splash.position));if(target)group.position.y+=.55;else group.position.y+=.035;
      const alpha=Math.min(1,(splash.expiresAt-now)/800);group.traverse(o=>{if(o instanceof THREE.Mesh)(o.material as THREE.Material).opacity=alpha*.85;});
    }
    const event=game.event,asset=event?.kind==='chair'&&event.expiresAt>now?this.layout.assets.find(a=>a.id===event.assetId):undefined;
    if(!asset&&this.chair){this.remove(this.chair);this.chair=null;}
    if(asset){this.chair??=this.disc('#ffe38c',.58);this.chair.position.fromArray(asset.position);this.chair.position.y=groundHeight(this.layout,asset.position[0],asset.position[2])+.06;this.chair.scale.setScalar(1+.1*Math.sin(now*.004));}
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.clear(this.projectiles);this.clear(this.splashes);this.clear(this.rings);if(this.chair)this.remove(this.chair);this.chair=null;this.root.removeFromParent();this.state=null;}
}
