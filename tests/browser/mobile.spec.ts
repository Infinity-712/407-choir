import {test,expect} from '@playwright/test';

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});

test('phone supports joystick walking, touch interaction and playable piano keys',async({page,context})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let position:number[]|undefined,mode='walk';
  page.on('websocket',socket=>socket.on('framereceived',frame=>{
    const payload=String(frame.payload);if(!payload.startsWith('42'))return;
    try{const [event,state]=JSON.parse(payload.slice(2));if(event==='state')for(const player of Object.values(state.players) as {name:string;position:number[];mode:string}[])if(player.name==='手机测试'){position=player.position;mode=player.mode;}}catch{}
  }));
  await page.goto('/');await page.getByLabel('你的昵称').fill('手机测试');await page.getByLabel('房间号',{exact:true}).fill('phone-'+Date.now());await page.getByRole('button',{name:'走，去小屋'}).tap();
  await expect(page.locator('.room-dock')).toBeVisible();await expect(page.locator('.room-loading')).toHaveCount(0,{timeout:60000});
  const stick=page.getByRole('button',{name:'移动摇杆'});await expect(stick).toBeVisible();
  const box=(await stick.boundingBox())!;const x=box.x+box.width/2,y=box.y+box.height/2;
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-48,id:1}]});
  await page.waitForTimeout(1650);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>position?.[1]??0).toBeGreaterThan(.6);
  await page.waitForTimeout(150);const stopped=position?.slice();await page.waitForTimeout(250);expect(position).toEqual(stopped);
  await page.screenshot({path:'artifacts/mobile-room-portrait.png'});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:210,y:400,id:2},{x:300,y:400,id:3}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:170,y:400,id:2},{x:340,y:400,id:3}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(250);expect(position).toEqual(stopped);
  await page.getByRole('button',{name:'房间地点',exact:true}).tap();
  await page.locator('.room-places button').filter({hasText:'黑色钢琴'}).tap();
  await expect(page.locator('.piano-panel')).toBeVisible({timeout:30000});expect(mode).toBe('piano');
  expect(await page.locator('.piano-key').count()).toBe(12);
  const key=(await page.getByRole('button',{name:'琴键 60',exact:true}).boundingBox())!;expect(key.width).toBeGreaterThan(40);
  const second=(await page.getByRole('button',{name:'琴键 64',exact:true}).boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:key.x+key.width/2,y:key.y+key.height-20,id:4},{x:second.x+second.width/2,y:second.y+second.height-20,id:5}]});
  await expect(page.locator('.piano-key.pressed')).toHaveCount(2);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.locator('.piano-key.pressed')).toHaveCount(0);
  await page.screenshot({path:'artifacts/mobile-piano-portrait.png'});
  await page.setViewportSize({width:844,height:390});await page.screenshot({path:'artifacts/mobile-piano-landscape.png'});
  await page.getByRole('button',{name:'结束演奏',exact:true}).tap();await expect(page.locator('.piano-panel')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
