import {test,expect,type Page} from '@playwright/test';

async function enter(page:Page){
  await page.goto('/');
  await page.getByLabel('你的昵称').fill('界面测试');
  await page.getByLabel('房间号',{exact:true}).fill('ui-'+Date.now());
  await page.getByRole('button',{name:'走，去小屋'}).click();
  await expect(page.locator('.room-dock')).toBeVisible();
  await expect(page.locator('.room-loading')).toHaveCount(0,{timeout:60000});
}

test('small landscape keeps four actions and a low joystick, with settings in more',async({browser})=>{
  const context=await browser.newContext({viewport:{width:844,height:320},hasTouch:true,isMobile:true});
  try{
    const page=await context.newPage();await enter(page);
    await expect(page.locator('.room-dock button:visible')).toHaveCount(4);
    const stick=(await page.getByRole('button',{name:'移动摇杆'}).boundingBox())!;
    expect(stick.width).toBeLessThanOrEqual(100);
    expect(320-stick.y-stick.height).toBeLessThanOrEqual(24);
    await expect(page.locator('.touch-camera-tools')).toBeHidden();
    await expect(page.getByRole('button',{name:'邀请朋友',exact:true})).toBeHidden();
    await page.getByRole('button',{name:'更多',exact:true}).tap();
    await expect(page.getByRole('button',{name:'移动摇杆'})).toBeHidden();
    await page.getByRole('button',{name:'声音与画质',exact:true}).tap();
    const quality=page.getByRole('combobox',{name:'画质模式'});
    await quality.selectOption('smooth');await expect(quality).toHaveValue('smooth');
    await page.getByRole('button',{name:'关闭面板',exact:true}).tap();
    await expect(page.getByRole('button',{name:'移动摇杆'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await context.close();}
});

test('desktop keeps its existing seven actions and no mobile menu or fullscreen button',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await enter(page);
  await expect(page.locator('.room-dock button:visible')).toHaveCount(7);
  await expect(page.getByRole('button',{name:'声音与画质',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'更多',exact:true})).toBeHidden();
  await expect(page.getByRole('button',{name:'进入全屏',exact:true})).toBeHidden();
  await expect(page.getByRole('button',{name:'邀请朋友',exact:true})).toBeVisible();
});

test('unsupported fullscreen gives a dismissible home screen guide',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  try{
    await context.addInitScript(()=>{
      Object.defineProperty(Element.prototype,'requestFullscreen',{value:undefined,configurable:true});
      Object.defineProperty(Element.prototype,'webkitRequestFullscreen',{value:undefined,configurable:true});
    });
    const page=await context.newPage();await enter(page);
    await page.getByRole('button',{name:'进入全屏',exact:true}).tap();
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/添加到主屏幕/).first()).toBeVisible();
    await expect(page.getByRole('button',{name:'移动摇杆'})).toBeHidden();
    await dialog.getByRole('button',{name:'关闭全屏说明',exact:true}).tap();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button',{name:'移动摇杆'})).toBeVisible();
  }finally{await context.close();}
});

test('supported browser enters and exits fullscreen with the room canvas intact',async({browser})=>{
  const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
  try{
    const page=await context.newPage();await enter(page);
    const canvas=await page.locator('.room-page canvas').elementHandle();
    await page.getByRole('button',{name:'进入全屏',exact:true}).tap();
    await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===document.documentElement)).toBe(true);
    await expect(page.locator('.room-dock')).toBeVisible();
    await page.getByRole('button',{name:'退出全屏',exact:true}).tap();
    await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
    expect(await canvas!.evaluate(node=>node===document.querySelector('.room-page canvas'))).toBe(true);
  }finally{await context.close();}
});

test('home screen app does not show a redundant fullscreen entry',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  try{
    await context.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true,configurable:true}));
    const page=await context.newPage();await enter(page);
    await expect(page.getByRole('button',{name:'进入全屏',exact:true})).toBeHidden();
    await expect(page.locator('.room-dock button:visible')).toHaveCount(4);
  }finally{await context.close();}
});
