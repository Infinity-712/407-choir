import {test,expect,type Page} from '@playwright/test';
import type {RoomState} from '../../shared/protocol';

async function enter(page:Page,name:string,room:string){
  await page.goto('/');
  await page.getByLabel('你的昵称').fill(name);
  await page.getByLabel('房间号',{exact:true}).fill(room);
  await page.getByRole('button',{name:'走，去小屋'}).click();
  await expect(page.locator('.room-dock')).toBeVisible();
  await expect(page.locator('.room-loading')).toHaveCount(0,{timeout:60000});
}

test('desktop and phone play a shared color war, preserve chat input, and reset together',async({browser})=>{
  test.setTimeout(150000);
  const desktop=await browser.newContext({viewport:{width:1440,height:1000}});
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const a=await desktop.newPage(),b=await phone.newPage(),errors:string[]=[];
  let latest:RoomState|undefined;
  const throws=new Set<string>();
  a.on('websocket',socket=>socket.on('framereceived',frame=>{
    const packet=String(frame.payload);if(!packet.startsWith('42'))return;
    try{const[event,state]=JSON.parse(packet.slice(2));if(event==='state'){
      latest=state as RoomState;
      for(const projectile of latest.colorWar?.projectiles??[])throws.add(projectile.id);
    }}catch{}
  }));
  for(const page of[a,b])page.on('pageerror',error=>errors.push(error.message));
  try{
    const room='paint-'+Date.now();
    await enter(a,'红豆',room);await enter(b,'蓝莓',room);
    for(const[page,team]of[[a,'S'],[b,'A']]as const){
      await expect(page.getByRole('button',{name:'颜色战争',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'颜色战争',exact:true}).click();
      await expect(page.getByRole('dialog',{name:'颜色战争'})).toBeVisible();
      await page.getByRole('button',{name:`加入${team}队`}).click();
      await page.getByRole('button',{name:'我准备好了'}).click();
    }
    await b.screenshot({path:'artifacts/color-war-mobile-lobby.png'});
    await a.getByRole('button',{name:'开始比赛'}).click();
    await expect(a.getByRole('dialog',{name:'颜色战争'})).toHaveCount(0);
    await expect(b.getByRole('dialog',{name:'颜色战争'})).toHaveCount(0);
    await expect(a.getByRole('button',{name:'投掷气球'})).toBeVisible();
    await expect(b.getByRole('button',{name:'投掷气球'})).toBeEnabled();
    await expect.poll(()=>latest?.colorWar?.phase).toBe('playing');
    const redId=Object.keys(latest!.players).find(id=>latest!.players[id].name==='红豆')!;
    const blueId=Object.keys(latest!.players).find(id=>latest!.players[id].name==='蓝莓')!;
    expect(latest!.colorWar!.members[redId].team).toBe('S');
    expect(latest!.colorWar!.members[blueId].team).toBe('A');

    // Button and keyboard use the same real network command; the phone uses touch.
    await a.getByRole('button',{name:'投掷气球'}).click();
    await expect.poll(()=>latest?.colorWar?.members[redId].nextThrowAt??0).toBeGreaterThan(0);
    await b.getByRole('button',{name:'投掷气球'}).tap();
    await expect.poll(()=>latest?.colorWar?.members[blueId].nextThrowAt??0).toBeGreaterThan(0);
    await expect.poll(()=>throws.size).toBeGreaterThan(0);
    const lastThrow=latest!.colorWar!.members[redId].nextThrowAt;
    await a.getByRole('button',{name:'聊天',exact:true}).click();
    const input=a.getByRole('textbox',{name:'聊天内容'});
    await input.pressSequentially('fff');await input.press('Enter');
    await expect(b.locator('.speech-bubble').filter({hasText:'fff'})).toBeVisible();
    expect(latest!.colorWar!.members[redId].nextThrowAt).toBe(lastThrow);
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(a.getByRole('button',{name:'投掷气球'})).toBeEnabled();
    await a.keyboard.press('f');
    await expect.poll(()=>latest?.colorWar?.members[redId].nextThrowAt??0).toBeGreaterThan(lastThrow);

    await expect(a.locator('.cw-task')).toBeVisible({timeout:15000});
    await expect(b.locator('.cw-task')).toBeVisible();
    await a.screenshot({path:'artifacts/color-war-desktop.png'});
    await b.screenshot({path:'artifacts/color-war-mobile.png'});
    expect(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const shoot=await b.getByRole('button',{name:'投掷气球'}).boundingBox();
    expect(shoot!.height).toBeGreaterThanOrEqual(44);
    expect(shoot!.x+shoot!.width).toBeLessThanOrEqual(390);

    await b.getByRole('button',{name:'房间地点',exact:true}).tap();
    await b.locator('.room-places button').filter({hasText:'黑色钢琴'}).tap();
    await expect(b.locator('.piano-panel')).toBeVisible({timeout:30000});
    await expect(b.locator('.cw-throw-controls')).toHaveCount(0);
    // Real touch hit testing, including the right-hand keys previously obscured by Throw.
    const cdp=await phone.newCDPSession(b);
    const highKey=(await b.getByRole('button',{name:'琴键 71',exact:true}).boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:highKey.x+highKey.width/2,y:highKey.y+35,id:9}]});
    await expect.poll(()=>latest?.pressedNotes?.[latest.players[blueId].assetId??'']).toContain(71);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await b.screenshot({path:'artifacts/color-war-mobile-piano.png'});
    await b.setViewportSize({width:844,height:390});
    await b.screenshot({path:'artifacts/color-war-mobile-piano-landscape.png'});
    await b.getByRole('button',{name:'结束演奏',exact:true}).tap();
    await b.setViewportSize({width:390,height:844});

    await a.getByRole('button',{name:'颜色战争',exact:true}).click();
    const beforeModal=latest!.colorWar!.members[redId].nextThrowAt;
    await a.keyboard.press('f');
    expect(latest!.colorWar!.members[redId].nextThrowAt).toBe(beforeModal);
    await a.getByRole('button',{name:'关闭颜色战争'}).click();
    // Ending while another overlay is open must expose usable result actions.
    await a.getByRole('button',{name:'聊天',exact:true}).click();
    await expect(a.getByRole('textbox',{name:'聊天内容'})).toBeVisible();
    await b.getByRole('button',{name:'颜色战争',exact:true}).tap();
    await b.getByRole('button',{name:'退出颜色战争'}).tap();
    await expect(a.getByRole('dialog',{name:'颜色战争'})).toBeVisible();
    await expect.poll(()=>latest?.colorWar?.phase).toBe('finished');
    expect(latest!.colorWar!.members[redId].nextThrowAt).toBe(0);
    await expect(a.getByRole('textbox',{name:'聊天内容'})).toHaveCount(0);
    await a.getByRole('button',{name:'再来一局'}).click();
    await expect(b.getByRole('button',{name:'加入A队'})).toBeVisible();
    await expect.poll(()=>latest?.colorWar?.phase).toBe('lobby');
    expect(latest!.colorWar!.projectiles).toEqual([]);
    expect(latest!.colorWar!.splashes).toEqual([]);
    expect(errors).toEqual([]);
  }finally{await desktop.close();await phone.close();}
});
