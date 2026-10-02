import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import type {RoomState} from '../../shared/protocol';
async function enter(page:Page,name:string,room:string){await page.goto('/');await page.getByLabel('你的昵称').fill(name);await page.getByLabel('房间号',{exact:true}).fill(room);await page.getByRole('button',{name:'走，去小屋'}).click();await expect(page.locator('.room-dock')).toBeVisible();await expect(page.locator('.room-loading')).toHaveCount(0,{timeout:45000});}
test('avatar studio persists real customization and renders on desktop and mobile',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('canvas')).toBeVisible();await page.getByLabel('你的昵称').fill('泡芙');await page.screenshot({path:'artifacts/studio-desktop.png',fullPage:true});
  await page.getByRole('tab',{name:'发型'}).click();await page.getByRole('button',{name:/双丸子/}).click();await page.reload();await page.getByRole('tab',{name:'发型'}).click();await expect(page.getByRole('button',{name:/双丸子/})).toHaveAttribute('aria-pressed','true');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/studio-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
});
test('two browsers share presence, piano ownership, voice and conductor state',async({browser})=>{
  await mkdir('artifacts',{recursive:true});const c1=await browser.newContext({permissions:['microphone'],viewport:{width:1440,height:1000}}),c2=await browser.newContext({permissions:['microphone'],viewport:{width:1200,height:900}});
  const p1=await c1.newPage(),p2=await c2.newPage(),errors:string[]=[];p1.on('pageerror',e=>errors.push(e.message));p2.on('pageerror',e=>errors.push(e.message));
  const room='test-'+Date.now();try{
    await enter(p1,'布丁',room);await enter(p2,'奶糖',room);await expect(p1.getByText('2 位伙伴在这里')).toBeVisible();await p1.screenshot({path:'artifacts/room-desktop.png'});
    await p2.getByRole('button',{name:'开启麦克风',exact:true}).click();await expect(p2.getByRole('button',{name:'麦克风已开启'})).toBeVisible();
    await p1.locator('.room-places button').filter({hasText:'钢琴'}).first().click();await expect(p1.locator('.piano-panel')).toBeVisible({timeout:30000});await expect(p1.getByRole('button',{name:'演奏中 · 麦克风关闭'})).toBeDisabled();await expect(p2.getByRole('button',{name:'麦克风已开启'})).toBeEnabled();
    await p1.keyboard.down('a');await p1.getByRole('button',{name:'琴键 60',exact:true}).dispatchEvent('pointerdown',{pointerId:1});await p1.getByRole('button',{name:'琴键 60',exact:true}).dispatchEvent('pointerup',{pointerId:1});await expect(p1.getByRole('button',{name:'琴键 60',exact:true})).toHaveClass(/pressed/);await p1.keyboard.up('a');await expect(p1.getByRole('button',{name:'琴键 60',exact:true})).not.toHaveClass(/pressed/);
    await p1.getByRole('button',{name:'操作帮助'}).click();await p1.keyboard.press('Escape');await expect(p1.locator('.help-modal')).toHaveCount(0);await expect(p1.locator('.piano-panel')).toBeVisible();
    await p2.locator('.room-places button').filter({hasText:'黑色钢琴'}).click();await expect(p2.getByRole('button',{name:'麦克风已开启'})).toBeVisible();
    await p1.screenshot({path:'artifacts/piano-desktop.png'});for(let i=0;i<4;i++)await p1.getByRole('button',{name:'降低八度'}).click();await expect(p1.getByRole('button',{name:'琴键 21',exact:true})).toBeVisible();for(let i=0;i<7;i++)await p1.getByRole('button',{name:'升高八度'}).click();await expect(p1.getByRole('button',{name:'琴键 108',exact:true})).toBeVisible();await expect(p1.getByRole('button',{name:'琴键 109',exact:true})).toHaveCount(0);await p1.getByRole('button',{name:'结束演奏'}).click();await expect(p1.locator('.piano-panel')).toHaveCount(0);await expect(p1.getByRole('button',{name:'开启麦克风',exact:true})).toBeVisible();
    await p1.locator('.room-places button').filter({hasText:/指挥/}).click();await expect(p1.locator('.conduct-panel')).toBeVisible({timeout:30000});await p1.getByRole('button',{name:'预备，开始'}).click();await expect(p2.locator('.beat-display')).toBeVisible();await p1.getByRole('button',{name:'离开指挥台'}).click();await expect(p2.locator('.beat-display')).toHaveCount(0);
    expect(errors).toEqual([]);
  }finally{await c1.close();await c2.close();}
});
test('walking up to a chair supports sit, chat, emote and stand without losing controls',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await enter(page,'小椅子','seat-'+Date.now());
  await page.keyboard.down('w');await page.waitForTimeout(650);await page.keyboard.up('w');await page.keyboard.press('e');
  await expect(page.getByRole('button',{name:'Esc 起身'})).toBeVisible();
  await page.getByRole('button',{name:'聊天',exact:true}).click();
  const input=page.getByRole('textbox',{name:'聊天内容'});
  await input.fill('坐着也可以聊天');await input.press('Enter');
  await expect(page.locator('.world-labels .speech-bubble')).toHaveText('坐着也可以聊天');
  await input.press('Escape');await expect(page.getByRole('button',{name:'Esc 起身'})).toBeVisible();
  await page.getByRole('button',{name:'表情动作',exact:true}).click();
  await page.getByRole('button',{name:'挥手',exact:true}).click();
  await page.screenshot({path:'artifacts/seated-desktop.png'});
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Esc 起身'})).toHaveCount(0);
  await page.keyboard.down('s');await page.waitForTimeout(250);await page.keyboard.up('s');expect(errors).toEqual([]);
});

test('new upright and digital piano support simultaneous playing and independent cleanup',async({browser})=>{
  test.setTimeout(120000);
  const c1=await browser.newContext(),c2=await browser.newContext();
  const p1=await c1.newPage(),p2=await c2.newPage();
  let latest:RoomState|undefined;
  const errors:string[]=[];
  for(const page of [p1,p2])page.on('pageerror',error=>errors.push(error.message));
  p1.on('websocket',socket=>socket.on('framereceived',frame=>{
    const packet=String(frame.payload);if(!packet.startsWith('42'))return;
    try{const [event,state]=JSON.parse(packet.slice(2));if(event==='state')latest=state as RoomState;}catch{}
  }));
  try{
    const room='duet-'+Date.now();
    await enter(p1,'窗边琴手',room);await enter(p2,'电琴琴手',room);
    for(const label of ['黑色钢琴','棕色钢琴','窗边立式钢琴','电钢琴']){
      await expect(p1.locator('.room-places button').filter({hasText:label})).toHaveCount(1);
    }
    await p1.locator('.room-places button').filter({hasText:'窗边立式钢琴'}).click();
    await expect(p1.locator('.piano-panel')).toBeVisible({timeout:30000});
    await p2.locator('.room-places button').filter({hasText:'电钢琴'}).click();
    await expect(p2.locator('.piano-panel')).toBeVisible({timeout:30000});
    await expect.poll(()=>Object.values(latest?.players??{}).filter(player=>player.mode==='piano').map(player=>player.assetId).sort()).toEqual(['piano-digital-black','piano-third-black']);
    await p1.keyboard.down('a');await p2.keyboard.down('a');
    await expect.poll(()=>latest?.notes['piano-third-black']).toEqual([60]);
    await expect.poll(()=>latest?.notes['piano-digital-black']).toEqual([60]);
    await p1.keyboard.down('Space');await p1.keyboard.up('a');
    await expect.poll(()=>latest?.pressedNotes?.['piano-third-black']).toEqual([]);
    await expect.poll(()=>latest?.notes['piano-third-black']).toEqual([60]);
    await expect.poll(()=>latest?.pedals?.['piano-digital-black']).toBe(false);
    await p1.getByRole('button',{name:'结束演奏',exact:true}).click();
    await p1.keyboard.up('Space');
    await expect.poll(()=>latest?.notes['piano-third-black']).toEqual([]);
    await expect.poll(()=>latest?.notes['piano-digital-black']).toEqual([60]);
    await expect(p2.getByRole('button',{name:'琴键 60',exact:true})).toHaveClass(/pressed/);
    await c2.close();
    await expect.poll(()=>latest?.notes['piano-digital-black']).toEqual([]);
    await expect.poll(()=>latest?.occupancy['piano-digital-black']).toBeUndefined();
    expect(errors).toEqual([]);
  }finally{await c1.close();await c2.close();}
});
