import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try {
  await page.goto(process.env.PREVIEW_URL??'http://localhost:5173');
  await page.evaluate(()=>localStorage.setItem('407-choir-avatar-v1',JSON.stringify({skin:'#f4c7a1',hairColor:'#d19aa4',shirtColor:'#ded99b',pantsColor:'#b3a491',hairStyle:'buns',outfit:'hoodie',accessory:'headphones',mouth:'smile'})));
  await page.reload();
  await page.getByLabel('你的昵称').fill('小桃');
  await page.getByLabel('房间号',{exact:true}).fill('visual-'+Date.now());
  await page.screenshot({path:'artifacts/refined-studio.png'});
  await page.getByRole('button',{name:'走，去小屋'}).click();
  await page.locator('.room-dock').waitFor();
  await page.locator('.room-loading').waitFor({state:'detached',timeout:90000});
  await page.waitForTimeout(2500);
  await page.screenshot({path:'artifacts/refined-room-back.png'});
  // Rotate the view around the player to see the room and the face together.
  const canvas=page.locator('.world-host canvas');
  const target=await canvas.count()?canvas:page.locator('canvas').first();
  const b=await target.boundingBox();
  await page.mouse.move(b.x+b.width*.55,b.y+b.height*.5);
  await page.mouse.down();await page.mouse.move(b.x+b.width*.55+524,b.y+b.height*.5,{steps:30});await page.mouse.up();
  await page.waitForTimeout(1000);
  await page.screenshot({path:'artifacts/refined-room-face.png'});
  const frame=await page.evaluate(()=>new Promise(resolve=>{let frames=0;const start=performance.now();function tick(){if(++frames===30)resolve((performance.now()-start)/29);else requestAnimationFrame(tick);}requestAnimationFrame(tick);}));
  await writeFile('artifacts/refined-capture.json',JSON.stringify({frameMs:frame,errors},null,2));
  console.log(JSON.stringify({frameMs:frame,errors}));
} finally {await browser.close();}
