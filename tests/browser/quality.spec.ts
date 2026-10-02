import {test,expect,type Page} from '@playwright/test';

async function enter(page:Page){
  await page.getByLabel('你的昵称').fill('画质测试');
  await page.getByLabel('房间号',{exact:true}).fill('quality-'+Date.now());
  await page.getByRole('button',{name:'走，去小屋'}).click();
  await expect(page.locator('.room-dock')).toBeVisible();
  await expect(page.locator('.room-loading')).toHaveCount(0,{timeout:60000});
  const more=page.getByRole('button',{name:'更多',exact:true});
  if(await more.isVisible())await more.click();
  await page.getByRole('button',{name:'声音与画质',exact:true}).click();
}

test('quality preferences persist and switch without replacing the room canvas',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await enter(page);
  const quality=page.getByRole('combobox',{name:'画质模式'});
  await expect(quality).toHaveValue('auto');
  const canvas=await page.locator('.room-page canvas').elementHandle();
  await quality.selectOption('smooth');
  await expect(page.locator('.room-page')).toHaveAttribute('data-quality','smooth');
  expect(await page.evaluate(()=>localStorage.getItem('407-quality'))).toBe('smooth');
  await quality.selectOption('standard');
  await expect(page.locator('.room-page')).toHaveAttribute('data-quality','standard');
  expect(await canvas!.evaluate(node=>node===document.querySelector('.room-page canvas'))).toBe(true);
  await quality.selectOption('smooth');
  await page.reload();await enter(page);
  await expect(quality).toHaveValue('smooth');
  await expect(page.locator('.room-page')).toHaveAttribute('data-quality','smooth');
  await quality.selectOption('auto');
  await expect(page.getByText('根据运行流畅度调整',{exact:false})).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile settings offer all quality modes without horizontal overflow',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  try{
    const page=await context.newPage();await page.goto('/');await enter(page);
    const quality=page.getByRole('combobox',{name:'画质模式'});
    await expect(quality).toBeVisible();
    await quality.selectOption('smooth');
    await expect(page.locator('.room-page')).toHaveAttribute('data-quality','smooth');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const box=await quality.boundingBox();expect(box!.width).toBeGreaterThan(100);
    await page.getByRole('button',{name:'关闭面板',exact:true}).click();
    await expect(page.getByRole('button',{name:'移动摇杆'})).toBeVisible();
  }finally{await context.close();}
});
