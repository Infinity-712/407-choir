import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Interior lighting and reflections come from the room geometry and its luminaires. */
export class RoomLighting {
  private composer:EffectComposer;
  private ao:GTAOPass;
  private renderPass:RenderPass;
  private output:OutputPass;
  private environment?:THREE.WebGLRenderTarget;
  private fixtures=new THREE.Group();
  private key:THREE.DirectionalLight;
  private lastShadow=0;
  private low=false;

  constructor(private scene:THREE.Scene,private camera:THREE.PerspectiveCamera,private renderer:THREE.WebGLRenderer){
    RectAreaLightUniformsLib.init();
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
    scene.background=new THREE.Color('#34333a');scene.fog=null;
    this.fixtures.name='room-interior-lighting';scene.add(this.fixtures);
    // Neutral indirect fill approximates the softly bounced light in the Cycles preview.
    this.fixtures.add(new THREE.HemisphereLight('#e9eef5','#9b8070',1.45));
    this.fixtures.add(new THREE.AmbientLight('#f3f2ee',.16));
    // Broad ceiling panels keep specular highlights soft and local.
    for(const x of [-4.1,0,4.1])for(const z of [-3.2,2.1]){
      const panel=new THREE.RectAreaLight('#fff5eb',7.5,1.8,.9);panel.position.set(x,3.38,z);panel.lookAt(x,0,z);this.fixtures.add(panel);
    }
    const bounce=new THREE.RectAreaLight('#e0bc9a',1,10,6);bounce.position.set(0,.035,0);bounce.lookAt(0,3.5,0);this.fixtures.add(bounce);
    this.key=new THREE.DirectionalLight('#fff8f0',.85);this.key.position.set(-.8,3.48,.6);this.key.target.position.set(0,.1,0);
    renderer.shadowMap.type=THREE.PCFShadowMap;
    this.key.castShadow=true;this.key.shadow.mapSize.set(2048,2048);Object.assign(this.key.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.05,far:16});this.key.shadow.normalBias=.024;this.key.shadow.bias=-.0003;this.key.shadow.radius=3;this.key.shadow.autoUpdate=false;this.key.shadow.needsUpdate=true;this.fixtures.add(this.key,this.key.target);
    const windowFill=new THREE.DirectionalLight('#dce5f2',.4);windowFill.position.set(1,2.5,-5);windowFill.target.position.set(0,1,0);this.fixtures.add(windowFill,windowFill.target);
    const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
    this.composer=new EffectComposer(renderer,target);
    this.renderPass=new RenderPass(scene,camera);this.ao=new GTAOPass(scene,camera,512,512);this.ao.blendIntensity=.55;
    this.ao.updateGtaoMaterial({radius:.32,thickness:.18,distanceExponent:1.4,distanceFallOff:.9,scale:1,samples:8});
    this.ao.updatePdMaterial({radius:5,rings:2,samples:8,lumaPhi:10,depthPhi:1,normalPhi:3});
    // The multisampled target already antialiases geometry; a second full-screen
    // SMAA pipeline added three passes without useful detail at these resolutions.
    this.output=new OutputPass();this.composer.addPass(this.renderPass);this.composer.addPass(this.ao);this.composer.addPass(this.output);
  }
  captureRoom(hidden:THREE.Object3D[]){
    const visible=hidden.map(o=>o.visible);hidden.forEach(o=>o.visible=false);
    const generator=new THREE.PMREMGenerator(this.renderer);const capture=new THREE.WebGLCubeRenderTarget(256,{type:THREE.HalfFloatType});
    const probe=new THREE.CubeCamera(.1,30,capture);probe.position.set(0,1.65,.2);
    try{probe.update(this.renderer,this.scene);this.environment=generator.fromCubemap(capture.texture);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.9;}
    finally{capture.dispose();generator.dispose();hidden.forEach((o,i)=>o.visible=visible[i]);}
    this.key.shadow.needsUpdate=true;
  }
  resize(width:number,height:number){
    // Bypassed postprocessing should not retain full-screen multisample targets.
    const w=this.low?1:width,h=this.low?1:height;
    this.composer.setPixelRatio(this.low?1:this.renderer.getPixelRatio());this.composer.setSize(w,h);
    const scale=Math.min(1.25,this.renderer.getPixelRatio());this.ao.setSize(Math.ceil(w*scale),Math.ceil(h*scale));
  }
  setQuality(low:boolean){this.low=low;this.key.castShadow=!low;this.key.shadow.needsUpdate=true;}
  render(time:number){if(time-this.lastShadow>90){this.key.shadow.needsUpdate=true;this.lastShadow=time;}if(this.low)this.renderer.render(this.scene,this.camera);else this.composer.render();}
  dispose(){this.scene.environment=null;this.environment?.dispose();this.renderPass.dispose();this.ao.dispose();this.output.dispose();this.composer.dispose();this.key.shadow.dispose();this.fixtures.removeFromParent();}
}
