import {test, expect, type Page} from '@playwright/test';
import {io,type Socket} from 'socket.io-client';
import type {Ack} from '../../shared/protocol';

async function openGame(page:Page, name:'抢凳子'|'颜色战争') {
  for(const label of ['关闭派对游戏','关闭颜色战争']){
    const close=page.getByRole('button',{name:label,exact:true});
    if(await close.isVisible())await close.click();
  }
  await page.getByRole('button',{name:'派对游戏',exact:true}).click();
  await page.getByRole('button',{name,exact:true}).click();
}

for (const mobile of [false,true]) {
  test(`${mobile?'small landscape phone':'desktop'} switches games through one entry without allowing overlapping lobbies`,async({browser})=>{
    const context=await browser.newContext(mobile
      ?{viewport:{width:568,height:320},isMobile:true,hasTouch:true}
      :{viewport:{width:1440,height:900}});
    const page=await context.newPage(),errors:string[]=[],room=`hub-${mobile?'m':'d'}-${Date.now()}`;
    let peer:Socket|undefined;
    page.on('pageerror',error=>errors.push(error.message));
    try {
      await page.goto('/');
      await page.getByLabel('你的昵称').fill('游戏切换');
      await page.getByLabel('房间号',{exact:true}).fill(room);
      await page.getByRole('button',{name:'走，去小屋'}).click();
      await expect(page.locator('.room-dock')).toBeVisible();
      await expect(page.locator('.room-loading')).toHaveCount(0,{timeout:60000});
      await expect(page.locator('.room-dock button:visible')).toHaveCount(mobile?4:7);
      await expect(page.getByRole('button',{name:'派对游戏',exact:true})).toHaveCount(1);

      await openGame(page,'抢凳子');
      await page.getByRole('button',{name:'报名参加',exact:true}).click();
      await expect(page.getByRole('button',{name:'退出报名',exact:true})).toBeVisible();
      if(mobile)await expect(page.getByRole('button',{name:'移动摇杆'})).toBeHidden();
      await openGame(page,'颜色战争');
      await expect(page.getByRole('button',{name:'加入S队',exact:true})).toBeDisabled();
      await expect(page.getByTestId('party-panel')).toHaveCount(0);

      await openGame(page,'抢凳子');
      await page.getByRole('button',{name:'退出报名',exact:true}).click();
      await expect(page.getByRole('button',{name:'报名参加',exact:true})).toBeVisible();
      await openGame(page,'颜色战争');
      await page.getByRole('button',{name:'加入S队',exact:true}).click();
      await expect(page.getByRole('button',{name:'退出颜色战争',exact:true})).toBeVisible();
      await openGame(page,'抢凳子');
      await expect(page.getByRole('button',{name:'报名参加',exact:true})).toBeDisabled();
      await expect(page.getByRole('dialog',{name:'颜色战争',exact:true})).toHaveCount(0);
      await openGame(page,'颜色战争');
      await page.getByRole('button',{name:'退出颜色战争',exact:true}).click();
      await openGame(page,'抢凳子');
      await expect(page.getByRole('button',{name:'报名参加',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'关闭派对游戏',exact:true}).click();
      if(mobile)await expect(page.getByRole('button',{name:'移动摇杆'})).toBeVisible();

      // A finished result releases the reservation. Its old Leave still works
      // while Reset is blocked by the next game's signup.
      peer=io(`http://127.0.0.1:${process.env.PORT??'3001'}`,{transports:['websocket'],reconnection:false});
      await new Promise<void>((resolve,reject)=>{peer!.once('connect',resolve);peer!.once('connect_error',reject);});
      const command=async(event:string,data:unknown={})=>{
        const response=await peer!.timeout(5000).emitWithAck(event,data) as Ack;
        expect(response.ok,response.error).toBe(true);
      };
      await command('join',{roomId:room,name:'蓝队伙伴'});
      await openGame(page,'颜色战争');
      await page.getByRole('button',{name:'加入S队',exact:true}).click();
      await page.getByRole('button',{name:'我准备好了',exact:true}).click();
      await command('color-war:join',{team:'A'});
      await command('color-war:ready',{ready:true});
      await page.getByRole('button',{name:'开始比赛',exact:true}).click();
      await expect(page.getByRole('button',{name:'投掷气球'})).toBeVisible();
      await openGame(page,'颜色战争');
      await page.getByRole('button',{name:'结束本局',exact:true}).click();
      await expect(page.getByRole('button',{name:'再来一局',exact:true})).toBeVisible();
      await openGame(page,'抢凳子');
      await page.getByRole('button',{name:'报名参加',exact:true}).click();
      await openGame(page,'颜色战争');
      await expect(page.getByRole('button',{name:'再来一局',exact:true})).toBeDisabled();
      await expect(page.getByRole('button',{name:'退出颜色战争',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'退出颜色战争',exact:true}).click();
      await openGame(page,'抢凳子');
      await expect(page.getByRole('button',{name:'退出报名',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'关闭派对游戏',exact:true}).click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally {peer?.disconnect();await context.close();}
  });
}
