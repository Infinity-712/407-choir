import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createAvatar } from '../avatar/AvatarRig';
import { RoomLighting } from './RoomLighting';
import { interactionTargets } from './interactionTargets';
import { CameraGestures } from './CameraGestures';
import { PianoKeyBatch } from './PianoKeyBatch';
import { RoomGeometryLOD } from './RoomGeometryLOD';
import { AdaptiveRenderQuality, type EffectiveQuality, type RenderQualityMode } from '../../shared/render-quality';
import { canStand, constrainRoomPosition, findPath, groundHeight, stepPosition } from '../../shared/movement';
import type { InteractionAsset, Player, RoomLayout, RoomState, Vec3 } from '../../shared/protocol';

type Rig=ReturnType<typeof createAvatar>;
type Person={rig:Rig;signature:string;label:HTMLDivElement;nameLabel:HTMLSpanElement;bubble:HTMLDivElement;target:THREE.Vector3;last:THREE.Vector3;mode:string};
export type WorldOptions={onMove:(position:Vec3,yaw:number,via:Vec3[])=>void;onSelect:(asset:InteractionAsset|null)=>void;onInteract:(asset:InteractionAsset)=>void;onLoad:(progress:number)=>void;onError:(message:string)=>void;onQualityChange?:(quality:EffectiveQuality)=>void;onListenerPose?:(position:Vec3,forward:Vec3,up:Vec3)=>void};
export class RoomWorld {
  private lighting:RoomLighting;
  private quality=new AdaptiveRenderQuality(devicePixelRatio,matchMedia('(pointer:coarse)').matches);
  private pianoBatch?:PianoKeyBatch;private geometryLOD?:RoomGeometryLOD;
  private width=1;private height=1;
  private scene=new THREE.Scene();private camera=new THREE.PerspectiveCamera(57,1,.07,80);private renderer:THREE.WebGLRenderer;
  private people=new Map<string,Person>();private keys=new Set<string>();private state:RoomState|null=null;private self='';
  private local=new THREE.Vector3();private yaw=Math.PI;private cameraYaw=0;private distance=3.8;private pitch=.35;
  private pressedKeys=new Map<string,THREE.Object3D>();private pianoNodes=new Map<string,{node:THREE.Object3D;base:number}>();
  private frame=0;private serverOffset=0;private lastTime=0;private lastSent=0;private disposed=false;private ready=false;private input=true;
  private resize:ResizeObserver;private targets:THREE.Mesh[]=[];private raycaster=new THREE.Raycaster();private pointer=new THREE.Vector2();
  private path:Vec3[]=[];private moveTrail:Vec3[]=[];private pending:InteractionAsset|null=null;private selected:InteractionAsset|null=null;private gestures=new CameraGestures();private lastListener=0;
  private ring:THREE.Mesh;private model?:THREE.Group;private marker:THREE.Mesh;private labels:HTMLDivElement;private touch={x:0,z:0};
  private handlers:{target:EventTarget;type:string;listener:EventListener}[]=[];private decoder=new DRACOLoader();
  constructor(private host:HTMLElement,private layout:RoomLayout,private options:WorldOptions){
    this.local.fromArray(layout.spawn);this.scene.matrixAutoUpdate=false;this.scene.background=new THREE.Color('#e3ded7');this.scene.fog=new THREE.Fog('#e5e0d9',20,45);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.renderer.domElement.setAttribute('aria-label','可交互的三维合唱房间');this.renderer.domElement.setAttribute('tabindex','0');host.append(this.renderer.domElement);
    this.renderer.domElement.style.touchAction='none';if(host.clientWidth<760)this.distance=4.5;
    this.labels=document.createElement('div');this.labels.className='world-labels';host.append(this.labels);
    this.lighting=new RoomLighting(this.scene,this.camera,this.renderer);
    this.ring=new THREE.Mesh(new THREE.TorusGeometry(.38,.023,6,48),new THREE.MeshBasicMaterial({color:'#af91e7',depthTest:true,transparent:true,opacity:.95}));this.ring.rotation.x=-Math.PI/2;this.ring.visible=false;this.ring.renderOrder=4;this.scene.add(this.ring);
    this.marker=new THREE.Mesh(new THREE.RingGeometry(.10,.16,24),new THREE.MeshBasicMaterial({color:'#91b6a4',side:THREE.DoubleSide,transparent:true,opacity:.8}));this.marker.rotation.x=-Math.PI/2;this.marker.visible=false;this.scene.add(this.marker);
    this.targets=interactionTargets(layout.assets);this.scene.add(...this.targets);
    this.decoder.setDecoderPath('/assets/draco/');this.decoder.setWorkerLimit(2);const loader=new GLTFLoader();loader.setDRACOLoader(this.decoder);
    loader.load(`/assets/room.glb?v=${layout.version}`,gltf=>{
      if(this.disposed){this.disposeObject(gltf.scene);return;}
      this.model=gltf.scene;this.scene.add(gltf.scene);
      gltf.scene.traverse(obj=>{if(obj instanceof THREE.Mesh){
        obj.receiveShadow=true;obj.castShadow=true;
        if(obj.userData.midi!==undefined)this.pianoNodes.set(`${obj.userData.instrumentId}:${obj.userData.midi}`,{node:obj,base:obj.position.y});
        for(const material of Array.isArray(obj.material)?obj.material:[obj.material])if(material instanceof THREE.MeshStandardMaterial){
          material.envMapIntensity=.65;
          if(/Night window glass/i.test(material.name)){obj.castShadow=false;material.color.setRGB(.045,.063,.082);material.roughness=.23;material.envMapIntensity=1.8;}
          if(/Maple plank/i.test(material.name)){material.color.setRGB(1.30,1.27,1.18);material.roughness=.38;if(material instanceof THREE.MeshPhysicalMaterial)material.clearcoatRoughness=.3;}
          if(/LED opal diffuser/i.test(material.name)){material.emissive.set('#fff2df');material.emissiveIntensity=3;}
        }
      }});
      this.pianoBatch=new PianoKeyBatch(gltf.scene);
      gltf.scene.traverse(obj=>{obj.updateMatrix();obj.matrixAutoUpdate=false;});
      this.lighting.captureRoom([...this.people.values()].map(p=>p.rig.group));
      this.geometryLOD=new RoomGeometryLOD(gltf.scene,()=>{const stats=this.geometryLOD!.statistics;const data=this.renderer.domElement.dataset;data.lodReady=String(stats.processedMeshes===stats.totalMeshes);data.lodTriangles=String(stats.smoothTriangles);data.originalTriangles=String(stats.originalTriangles);});
      this.geometryLOD.setLow(this.quality.current.effective==='smooth');
      this.ready=true;options.onLoad(100);
    },e=>options.onLoad(e.total?Math.round(e.loaded/e.total*85):35),()=>options.onError('房间模型加载失败，请刷新重试'));
    this.resize=new ResizeObserver(()=>this.resizeCanvas());this.resize.observe(host);this.resizeCanvas();
    const listen=(target:EventTarget,type:string,fn:EventListener)=>{target.addEventListener(type,fn);this.handlers.push({target,type,listener:fn});};
    listen(window,'keydown',((e:KeyboardEvent)=>{if(e.isComposing||e.keyCode===229||this.isTyping(e.target)||!this.input)return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){this.keys.add(e.code);this.path=[];this.pending=null;e.preventDefault();}if(e.code==='KeyE'&&!e.repeat){const a=this.selected??this.nearest();if(a)this.goTo(a);}}) as EventListener);
    listen(window,'keyup',((e:KeyboardEvent)=>{this.keys.delete(e.code);}) as EventListener);
    listen(window,'blur',(()=>{this.keys.clear();this.touch={x:0,z:0};this.gestures.cancel();}) as EventListener);
    listen(this.renderer.domElement,'contextmenu',((e:Event)=>e.preventDefault()));
    listen(this.renderer.domElement,'pointerdown',((e:PointerEvent)=>{this.gestures.down(e.pointerId,e.clientX,e.clientY);this.renderer.domElement.setPointerCapture(e.pointerId);}) as EventListener);
    listen(this.renderer.domElement,'pointermove',((e:PointerEvent)=>{const gesture=this.gestures.move(e.pointerId,e.clientX,e.clientY);if(gesture){this.cameraYaw-=gesture.dx*.006;this.pitch=THREE.MathUtils.clamp(this.pitch+gesture.dy*.004,.2,1.05);this.zoom(gesture.zoom*.012);}else if(!this.gestures.active&&e.pointerType!=='touch')this.hover(e);}) as EventListener);
    listen(this.renderer.domElement,'pointerup',((e:PointerEvent)=>{if(this.gestures.up(e.pointerId)&&this.input)this.click(e);}) as EventListener);
    listen(this.renderer.domElement,'pointercancel',(()=>this.gestures.cancel()) as EventListener);
    listen(this.renderer.domElement,'lostpointercapture',((e:PointerEvent)=>{this.gestures.up(e.pointerId);}) as EventListener);
    listen(this.renderer.domElement,'wheel',((e:WheelEvent)=>{this.distance=THREE.MathUtils.clamp(this.distance+e.deltaY*.004,1.4,5.8);e.preventDefault();}) as EventListener);
    this.frame=requestAnimationFrame(t=>this.update(t));
  }
  private isTyping(target:EventTarget|null){return target instanceof HTMLElement&&(['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||target.isContentEditable);}
  private resizeCanvas(){const {clientWidth:w,clientHeight:h}=this.host;if(w&&h){this.width=w;this.height=h;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.lighting.resize(w,h);}}
  private point(e:PointerEvent){const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);}
  private hover(e:PointerEvent){this.point(e);const hit=this.raycaster.intersectObjects(this.targets,false)[0];const asset=hit?.object.userData.asset as InteractionAsset|undefined;if(asset?.id!==this.selected?.id){this.selected=asset??null;this.options.onSelect(this.selected);}this.renderer.domElement.style.cursor=asset?'pointer':'grab';}
  private click(e:PointerEvent){this.point(e);const hit=this.raycaster.intersectObjects(this.targets,false)[0];if(hit){this.goTo(hit.object.userData.asset);return;}let point:THREE.Vector3|null=null,best=Infinity;for(const height of new Set([0,...this.layout.floors.map(f=>f.height)])){const candidate=this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-height),new THREE.Vector3());if(candidate&&Math.abs(groundHeight(this.layout,candidate.x,candidate.z)-height)<.001&&canStand(this.layout,candidate.x,candidate.z)){const distance=candidate.distanceTo(this.camera.position);if(distance<best){point=candidate;best=distance;}}}if(point){this.path=findPath(this.layout,this.local.toArray() as Vec3,[point.x,point.y,point.z]);this.pending=null;if(this.path.length){this.marker.position.fromArray(this.path.at(-1)!);this.marker.position.y+=.025;this.marker.visible=true;}}}
  goTo(asset:InteractionAsset){if(this.state?.players[this.self]?.mode!=='walk'){this.options.onInteract(asset);return;}const dist=Math.hypot(this.local.x-asset.approach[0],this.local.z-asset.approach[2]);if(dist<asset.radius-.15){this.options.onInteract(asset);return;}this.path=findPath(this.layout,this.local.toArray() as Vec3,asset.approach);this.pending=asset;if(!this.path.length){this.options.onError('这边暂时走不过去，试着从过道靠近');this.pending=null;}else{this.marker.position.fromArray(asset.approach);this.marker.position.y+=.025;this.marker.visible=true;}}
  nearest(){let best:InteractionAsset|null=null,d=Infinity;for(const a of this.layout.assets){const distance=Math.hypot(a.approach[0]-this.local.x,a.approach[2]-this.local.z);if(distance<a.radius&&distance<d){best=a;d=distance;}}return best;}
  takeMovement(){const movement={position:this.local.toArray() as Vec3,yaw:this.yaw,via:this.moveTrail};this.moveTrail=[];return movement;}
  reconcilePosition(position:Vec3,yaw:number){this.local.fromArray(position);this.yaw=yaw;this.moveTrail=[];this.path=[];this.pending=null;this.marker.visible=false;}
  setTouch(x:number,z:number){this.touch={x,z};this.path=[];this.pending=null;}
  zoom(delta:number){this.distance=THREE.MathUtils.clamp(this.distance+delta,1.4,5.8);}
  setInputEnabled(enabled:boolean){this.input=enabled;if(!enabled){this.keys.clear();this.touch={x:0,z:0};this.path=[];this.pending=null;}}
  setQualityMode(mode:RenderQualityMode){this.quality.setMode(mode);this.applyQuality();}
  private applyQuality(){const {effective,pixelRatio}=this.quality.current;const low=effective==='smooth';this.renderer.setPixelRatio(pixelRatio);this.renderer.shadowMap.enabled=!low;this.lighting.setQuality(low);this.geometryLOD?.setLow(low);this.resizeCanvas();this.renderer.domElement.dataset.quality=effective;this.renderer.domElement.dataset.pixelRatio=String(pixelRatio);this.options.onQualityChange?.(effective);}
  setState(state:RoomState,self:string){
    const previous=this.state?.players[self];this.state=state;this.self=self;this.serverOffset=state.serverTime-Date.now();const me=state.players[self];
    if(me&&(!previous||previous.mode!==me.mode||previous.assetId!==me.assetId||this.local.distanceTo(new THREE.Vector3(...me.position))>1)){this.local.fromArray(me.position);this.yaw=me.yaw;this.path=[];this.moveTrail=[];this.pending=null;}
    for(const [id,person]of this.people)if(!state.players[id]){person.rig.dispose();this.scene.remove(person.rig.group);person.label.remove();this.people.delete(id);}
    for(const player of Object.values(state.players)){
      const signature=JSON.stringify(player.avatar);let person=this.people.get(player.id);
      if(!person||person.signature!==signature){if(person){person.rig.dispose();this.scene.remove(person.rig.group);person.label.remove();}const rig=createAvatar(player.avatar);rig.group.scale.setScalar(.84);rig.group.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});this.scene.add(rig.group);const label=document.createElement('div');label.className='person-label'+(player.id===self?' self':'');const nameLabel=document.createElement('span');nameLabel.className='person-name';const bubble=document.createElement('div');bubble.className='speech-bubble';bubble.hidden=true;label.append(bubble,nameLabel);this.labels.append(label);person={rig,signature,label,nameLabel,bubble,target:new THREE.Vector3(...player.position),last:new THREE.Vector3(...player.position),mode:player.mode};rig.group.position.fromArray(player.position);this.people.set(player.id,person);}
      const name=player.name+(player.mic?' · ◉':'');if(person.nameLabel.textContent!==name)person.nameLabel.textContent=name;
      const chat=player.chat;
      if(chat){if(person.bubble.textContent!==chat.text){person.bubble.textContent=chat.text;person.bubble.classList.toggle('emoji-only',Array.from(chat.text).length<=16&&/\p{Extended_Pictographic}/u.test(chat.text)&&!/[\p{Letter}\p{Number}]/u.test(chat.text));}if(person.bubble.dataset.palette!==chat.style.palette)person.bubble.dataset.palette=chat.style.palette;if(person.bubble.dataset.shape!==chat.style.shape)person.bubble.dataset.shape=chat.style.shape;}
      person.bubble.hidden=!chat||chat.until<=Date.now()+this.serverOffset;
      person.target.fromArray(player.position);person.mode=player.mode;
    }
    const downKeys=state.pressedNotes??state.notes;
    for(const key of this.pressedKeys.keys()){const [asset,note]=key.split(':');if(!downKeys[asset]?.includes(Number(note)))this.key(asset,Number(note),false);}
    for(const [asset,notes]of Object.entries(downKeys))for(const note of notes)this.key(asset,note,true);
  }
  key(assetId:string,midi:number,down:boolean){const key=assetId+':'+midi,n=this.pianoNodes.get(key);if(n&&this.pressedKeys.has(key)!==down){if(!this.pianoBatch?.setKey(assetId,midi,down)){n.node.position.y=n.base-(down?.008:0);n.node.updateMatrix();}if(down)this.pressedKeys.set(key,n.node);else this.pressedKeys.delete(key);}}
  clearKeys(assetId?:string){for(const key of [...this.pressedKeys.keys()]){const [asset,midi]=key.split(':');if(!assetId||asset===assetId)this.key(asset,Number(midi),false);}}
  private update(t:number){if(this.disposed)return;this.frame=requestAnimationFrame(n=>this.update(n));const frameMs=t-this.lastTime;this.lastTime=t;if(this.quality.sample(frameMs,this.ready&&!document.hidden))this.applyQuality();if(document.hidden)return;const dt=Math.min(.05,frameMs/1000||.016);const me=this.state?.players[this.self];const now=Date.now()+this.serverOffset;let speed=0;
    if(me?.mode==='walk'&&this.input&&this.ready){let dx=0,dz=0;const forward=Number(this.keys.has('KeyW')||this.keys.has('ArrowUp'))-Number(this.keys.has('KeyS')||this.keys.has('ArrowDown'))-this.touch.z;const side=Number(this.keys.has('KeyD')||this.keys.has('ArrowRight'))-Number(this.keys.has('KeyA')||this.keys.has('ArrowLeft'))+this.touch.x;
      if(forward||side){dx=-Math.sin(this.cameraYaw)*forward+Math.cos(this.cameraYaw)*side;dz=-Math.cos(this.cameraYaw)*forward-Math.sin(this.cameraYaw)*side;}
      else if(this.path.length){while(this.path.length&&Math.hypot(this.path[0][0]-this.local.x,this.path[0][2]-this.local.z)<.025)this.path.shift();if(this.path.length){dx=this.path[0][0]-this.local.x;dz=this.path[0][2]-this.local.z;}else{this.marker.visible=false;if(this.pending){const a=this.pending;this.pending=null;this.options.onInteract(a);}}}
      if(dx||dz){const length=Math.hypot(dx,dz);speed=(this.keys.has('ShiftLeft')||this.keys.has('ShiftRight')?3.8:2.6)*((forward||side)?Math.min(1,Math.hypot(forward,side)):1);const step=Math.min(speed*dt,length);const next=stepPosition(this.layout,this.local.toArray() as Vec3,[this.local.x+dx/length*step,this.local.y,this.local.z+dz/length*step]);const moved=Math.hypot(next[0]-this.local.x,next[2]-this.local.z);if(moved>.0001){this.local.fromArray(next);this.moveTrail.push([...next]);this.yaw=Math.atan2(dx,dz);}else speed=0;}
      if(this.moveTrail.length&&(t-this.lastSent>80||this.moveTrail.length>=28)){this.lastSent=t;const move=this.takeMovement();this.options.onMove(move.position,move.yaw,move.via);}
    }
    if(me&&me.mode!=='walk'){this.local.fromArray(me.position);this.yaw=me.yaw;}
    for(const [id,p]of this.people){const player=this.state?.players[id];if(!player)continue;const root=p.rig.group;const posePosition=(id===this.self?this.local:p.target).clone();if(player.mode==='piano')posePosition.add(new THREE.Vector3(Math.sin(player.yaw)*.14,0,Math.cos(player.yaw)*.14));if(id===this.self){root.position.copy(posePosition);root.rotation.y=this.yaw;}else{root.position.lerp(posePosition,Math.min(1,dt*13));root.rotation.y+=Math.atan2(Math.sin(player.yaw-root.rotation.y),Math.cos(player.yaw-root.rotation.y))*Math.min(1,dt*12);}
      const moving=id===this.self?speed:root.position.distanceTo(p.last)/dt;p.last.copy(root.position);p.rig.animate(t/1000,{mode:player.mode,speed:moving,emote:player.emoteUntil>now?player.emote:null,pose:player.pose,poseAt:player.poseAt,now,conductor:this.state?.conductor});
    }
    const target=this.local.clone().add(new THREE.Vector3(0,(me?.mode==='sit'||me?.mode==='piano')?.52:.85,0));const offset=new THREE.Vector3(Math.sin(this.cameraYaw)*Math.cos(this.pitch)*this.distance,Math.sin(this.pitch)*this.distance,Math.cos(this.cameraYaw)*Math.cos(this.pitch)*this.distance);const desired=new THREE.Vector3(...constrainRoomPosition(this.layout,target.toArray() as Vec3,target.clone().add(offset).toArray() as Vec3));desired.y=Math.min(3.36,desired.y);this.camera.position.lerp(desired,Math.min(1,dt*9));this.camera.position.fromArray(constrainRoomPosition(this.layout,target.toArray() as Vec3,this.camera.position.toArray() as Vec3));this.camera.lookAt(target);if(me&&t-this.lastListener>=50){this.lastListener=t;const ear=this.local.clone();ear.y+=(me.mode==='sit'||me.mode==='piano')?.65:1;this.options.onListenerPose?.(ear.toArray() as Vec3,this.camera.getWorldDirection(new THREE.Vector3()).toArray() as Vec3,this.camera.up.toArray() as Vec3);}
    const active=this.selected??this.nearest();this.ring.visible=!!active&&me?.mode==='walk'&&this.input;if(active){this.ring.position.fromArray(active.position);this.ring.position.y=groundHeight(this.layout,active.position[0],active.position[2])+.04;(this.ring.material as THREE.MeshBasicMaterial).color.set(this.state?.occupancy[active.id]?'#e4ae8c':'#a991de');}
    // Project after moving the camera, keeping the bubble above its own name.
    this.camera.updateMatrixWorld();
    const projected:{person:Person;x:number;y:number}[]=[];
    for(const [id,p]of this.people){
      const player=this.state?.players[id];if(!player)continue;
      p.bubble.hidden=!player.chat||player.chat.until<=now;
      const position=p.rig.group.position.clone().add(new THREE.Vector3(0,player.mode==='sit'||player.mode==='piano'?.99:1.27,0)).project(this.camera);
      const visible=position.z>-1&&position.z<1&&Math.abs(position.x)<1&&Math.abs(position.y)<1;
      p.label.hidden=!visible;
      if(visible)projected.push({person:p,x:(position.x*.5+.5)*this.width,y:(-position.y*.5+.5)*this.height});
    }
    // Finish visibility/content writes before measuring any label, then apply transforms.
    const labels=projected.map(({person,x,y})=>{const width=person.label.offsetWidth,height=person.label.offsetHeight,half=Math.min(width/2,this.width/2-10);return{person,width,height,x:THREE.MathUtils.clamp(x,half+8,this.width-half-8),y:THREE.MathUtils.clamp(y,Math.min(this.height-8,height+10),this.height-8)};});
    // Keep each name with its message when several avatars line up in the view.
    const placed:{left:number;right:number;top:number;bottom:number}[]=[];
    for(const item of labels.sort((a,b)=>b.y-a.y)){
      const left=item.x-item.width/2,right=item.x+item.width/2;
      let bottom=item.y;
      for(let attempt=0;attempt<placed.length;attempt++){
        const hit=placed.find(rect=>left<rect.right+6&&right>rect.left-6&&bottom-item.height<rect.bottom+6&&bottom>rect.top-6);
        if(!hit)break;
        bottom=hit.top-8;
      }
      bottom=Math.max(item.height+8,bottom);
      item.person.label.style.transform=`translate(${item.x}px,${bottom}px) translate(-50%,-100%)`;
      item.person.label.style.zIndex=item.person.bubble.hidden?'1':'2';
      placed.push({left,right,top:bottom-item.height,bottom});
    }
    this.lighting.render(t);
  }
  private disposeObject(root:THREE.Object3D,materials=new Set<THREE.Material>()){const textures=new Set<THREE.Texture>(),geometries=new Set<THREE.BufferGeometry>();root.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});for(const g of geometries)g.dispose();for(const m of materials){for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);m.dispose();}for(const t of textures)t.dispose();}
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resize.disconnect();this.handlers.forEach(h=>h.target.removeEventListener(h.type,h.listener));for(const p of this.people.values())p.rig.dispose();this.people.clear();this.geometryLOD?.dispose();this.lighting.dispose();const materials=new Set<THREE.Material>();this.model?.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});this.pianoBatch?.dispose();this.disposeObject(this.scene,materials);this.pianoNodes.clear();this.pressedKeys.clear();this.decoder.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();this.labels.remove();}
}












