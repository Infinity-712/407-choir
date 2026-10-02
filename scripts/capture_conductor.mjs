import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('http://localhost:5173');
  await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {createAvatar}=await import('/src/avatar/AvatarRig.ts');
    document.body.replaceChildren();
    document.body.style.cssText='margin:0;background:#eee9e3;display:grid;grid-template-columns:repeat(4,1fr);font:16px sans-serif;color:#4c3c48';
    const states=[['预备',false,'beat',0],['下拍',true,'beat',0],['上拍',true,'beat',1000],['收拍',false,'cutoff',300]];
    for(const [view,position] of [['正面',[0,.85,3]],['侧面',[3,.85,0]],['背面',[0,.85,-3]]]){
      for(const [title,playing,gesture,elapsed] of states){
        const cell=document.createElement('div');cell.style.cssText='height:350px;position:relative';document.body.append(cell);
        const caption=document.createElement('div');caption.textContent=`${view} · ${title}`;caption.style.cssText='position:absolute;left:16px;top:12px';cell.append(caption);
        const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(360,350);renderer.setPixelRatio(1);cell.append(renderer.domElement);
        renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
        const scene=new THREE.Scene();scene.background=new THREE.Color('#eee9e3');
        scene.add(new THREE.HemisphereLight('#ffffff','#9d8780',2));
        const light=new THREE.DirectionalLight('#fff4e6',3);light.position.set(-2,3,4);scene.add(light);
        const rig=createAvatar();scene.add(rig.group);
        rig.animate(0,{mode:'conduct',speed:0,emote:null,now:1000000+elapsed,conductor:{beats:2,bpm:60,playing,startAt:1000000,gesture,gestureAt:1000000}});
        const camera=new THREE.OrthographicCamera(-.53,.53,.515,-.515,.01,10);camera.position.fromArray(position);camera.lookAt(0,.88,0);
        renderer.render(scene,camera);
      }
    }
  });
  await page.screenshot({path:'artifacts/conductor-joints-views.png'});
  await page.goto(process.env.PREVIEW_URL??'http://localhost:3001');
  await page.getByLabel('你的昵称').fill('指挥动作检查');
  await page.getByLabel('房间号',{exact:true}).fill('gesture-check-'+Date.now());
  await page.getByRole('button',{name:'走，去小屋'}).click();
  await expect(page.locator('.room-loading')).toHaveCount(0,{timeout:60000});
  await page.locator('.room-places button').filter({hasText:'指挥台'}).click();
  await expect(page.locator('.conduct-panel')).toBeVisible({timeout:30000});
  const canvas=page.locator('.world-host canvas');
  await canvas.hover();await page.mouse.wheel(0,-350);await page.waitForTimeout(350);
  await page.screenshot({path:'artifacts/conductor-room-back.png'});
  for(const view of ['side','front']){
    await page.mouse.move(750,450);await page.mouse.down();await page.mouse.move(1012,450,{steps:25});await page.mouse.up();await page.waitForTimeout(350);
    await page.screenshot({path:`artifacts/conductor-room-${view}.png`});
  }
  await page.getByRole('button',{name:'起拍',exact:true}).click();
  await expect(page.locator('.beat-display')).toBeVisible();
  await page.waitForTimeout(1700);
  await page.screenshot({path:'artifacts/conductor-room-moving.png'});
  expect(errors).toEqual([]);
  console.log('Conductor: diagnostic views, production room, shared beat UI, zero page errors.');
}finally{await browser.close();}
