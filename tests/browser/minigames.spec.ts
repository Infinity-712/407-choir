import {test,expect,type Page} from '@playwright/test';
import {io,type Socket} from 'socket.io-client';
import {readFileSync} from 'node:fs';
import {GAME_CENTER,GAME_WALK_RADIUS,getMinigameLayout,type MusicalChairsState} from '../../shared/minigames';
import {findPath,stepPosition} from '../../shared/movement';
import type {Ack,RoomLayout,RoomState,Vec3} from '../../shared/protocol';

// Real browser controls and real Socket.IO peers use the production timers and
// movement validator. There is no test-only server clock or teleport endpoint.
test.use({actionTimeout:15000});
const backend=`http://127.0.0.1:${process.env.PORT??'3001'}`;
const layout=JSON.parse(readFileSync(new URL('../../public/assets/interaction-layout.json',import.meta.url),'utf8')) as RoomLayout;
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const emit=(socket:Socket,event:string,data:unknown={})=>socket.timeout(5000).emitWithAck(event,data) as Promise<Ack>;
async function peer(room:string,name:string,sockets:Socket[]){
  const socket=io(backend,{transports:['websocket'],reconnection:false});sockets.push(socket);
  await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  expect((await emit(socket,'join',{roomId:room,name})).ok).toBe(true);
  return socket;
}
async function enter(page:Page,name:string,room:string){
  await page.goto('/');await page.getByLabel('你的昵称').fill(name);await page.getByLabel('房间号',{exact:true}).fill(room);await expect(page.getByLabel('房间号',{exact:true})).toHaveValue(room);
  await page.getByRole('button',{name:'走，去小屋'}).click();
  await expect(page.locator('.room-dock')).toBeVisible();await expect(page.locator('.room-loading')).toHaveCount(0,{timeout:60000});
}
async function snapshot(observer:Socket){
  const response=await emit(observer,'sync');expect(response.ok).toBe(true);expect(response.state).toBeTruthy();return response.state!;
}
async function waitPhase(observer:Socket,phase:MusicalChairsState['phase'],round?:number){
  await expect.poll(async()=>{const game=(await snapshot(observer)).minigame;return game?.phase===phase&&(round===undefined||game.round===round);},{timeout:25000,intervals:[100,200]}).toBe(true);
  return (await snapshot(observer)).minigame!;
}
async function walkPeer(socket:Socket,state:RoomState){
  const player=state.players[socket.id!],game=state.minigame!;
  const angle=Math.atan2(player.position[0]-GAME_CENTER[0],player.position[2]-GAME_CENTER[2])+.18;
  const target:Vec3=[GAME_CENTER[0]+Math.sin(angle)*GAME_WALK_RADIUS,0,GAME_CENTER[2]+Math.cos(angle)*GAME_WALK_RADIUS];
  const next=stepPosition(getMinigameLayout(layout,game),player.position,target);
  expect((await emit(socket,'move',{position:next,yaw:angle})).ok).toBe(true);
}
async function walkMusic(page:Page,observer:Socket,peers:Socket[],round:number){
  await waitPhase(observer,'music',round);
  let tick=0;
  try{
    while(true){
      const state=await snapshot(observer),game=state.minigame!;
      if(game.phase!=='music')break;
      expect(game.phaseEndsAt,'future music stop remains private').toBeNull();
      // Tangential back-and-forth walks around the browser's outer-ring start.
      const key=Math.floor(tick++/3)%2===0?'a':'d';
      await page.keyboard.up(key==='a'?'d':'a');await page.keyboard.down(key);
      await Promise.all(peers.map(socket=>walkPeer(socket,state)));
      await pause(200);
    }
  }finally{await page.keyboard.up('a');await page.keyboard.up('d');}
  const game=await waitPhase(observer,'scramble',round);
  for(const id of game.alive)expect(game.movement[id]?.eligible,`participant ${id} must really walk`).toBe(true);
  return game;
}
async function approachAndClaim(socket:Socket,observer:Socket,chair:MusicalChairsState['chairs'][number]){
  const initial=await snapshot(observer),game=initial.minigame!;
  const path=findPath(getMinigameLayout(layout,game),initial.players[socket.id!].position,chair.approach);
  expect(path.length).toBeGreaterThan(0);
  for(const position of path){await pause(90);expect((await emit(socket,'move',{position,yaw:chair.rotation})).ok).toBe(true);}
  const result=await emit(socket,'minigame',{action:'claim',assetId:chair.id,gameId:game.gameId,round:game.round});
  expect(result.ok,result.error).toBe(true);
}

test('three people play two real rounds through browser controls and the winner names a singer',async({page})=>{
  test.setTimeout(150000);
  const sockets:Socket[]=[],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const room=`chairs-${Date.now()}`;
  try{
    await enter(page,'浏览器冠军',room);
    const observer=await peer(room,'观众',sockets),second=await peer(room,'奶糖',sockets),third=await peer(room,'布丁',sockets);
    await page.getByRole('button',{name:'派对游戏',exact:true}).click();
    await expect(page.getByTestId('party-panel')).toBeVisible();
    await page.getByRole('button',{name:'报名参加',exact:true}).click();
    expect((await emit(second,'minigame',{action:'join'})).ok).toBe(true);
    expect((await emit(third,'minigame',{action:'join'})).ok).toBe(true);
    await expect(page.getByRole('button',{name:'开始游戏',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'开始游戏',exact:true}).click();
    await expect(page.getByTestId('party-panel')).toBeHidden();
    await expect(page.getByTestId('party-status')).toBeVisible();
    await waitPhase(observer,'music',1);
    const music=(await snapshot(observer)).minigame!;
    expect((await emit(observer,'minigame',{action:'claim',assetId:music.chairs[0].id,gameId:music.gameId,round:1})).ok).toBe(false);
    expect((await emit(second,'claim',{assetId:music.chairs[0].id})).ok).toBe(false);
    await expect(page.getByTestId('party-status')).toContainText('音乐响起，动起来');
    const first=await walkMusic(page,observer,[second,third],1);
    await page.screenshot({path:'artifacts/minigames-scramble-desktop.png'});
    await expect(page.getByTestId('party-status')).toContainText('音乐停了，快抢凳子');
    await page.getByRole('button',{name:'抢凳子 1',exact:true}).click();
    await expect.poll(async()=>Object.values((await snapshot(observer)).minigame!.seats).some(id=>id!==second.id&&id!==third.id),{timeout:10000}).toBe(true);
    await expect(page.locator('.interaction-prompt')).toContainText('抢座成功，等待下一轮');
    await expect(page.getByRole('button',{name:'Esc 起身',exact:true})).toHaveCount(0);
    await approachAndClaim(second,observer,first.chairs[1]);
    const ended=await waitPhase(observer,'roundEnd',1);expect(ended.eliminated).toEqual([third.id]);expect(ended.alive).toHaveLength(2);
    const final=await walkMusic(page,observer,[second],2);expect(final.chairs).toHaveLength(1);
    expect((await emit(third,'minigame',{action:'claim',assetId:final.chairs[0].id,gameId:final.gameId,round:2})).ok).toBe(false);
    expect((await emit(second,'minigame',{action:'claim',assetId:first.chairs[0].id,gameId:first.gameId,round:1})).ok).toBe(false);
    await page.getByRole('button',{name:'抢凳子 1',exact:true}).click();
    const finished=await waitPhase(observer,'finished',2);
    expect((await snapshot(observer)).players[finished.winnerId!].name).toBe('浏览器冠军');
    await expect(page.getByTestId('party-panel')).toBeVisible();
    await page.getByRole('button',{name:'点名奶糖唱歌',exact:true}).click();
    await expect.poll(async()=>(await snapshot(observer)).minigame?.singerId).toBe(second.id);
    await expect(page.locator('.party-person-badge').filter({hasText:'🎤 被选唱歌'})).toBeVisible();
    await expect(page.getByTestId('party-panel')).toContainText('奶糖被冠军点名');
    await page.getByRole('button',{name:'关闭派对游戏',exact:true}).click();
    await expect(page.getByTestId('party-status')).toContainText('奶糖被冠军点名');
    await page.screenshot({path:'artifacts/minigames-winner-desktop.png'});
    expect((await snapshot(observer)).players[second.id!].mic).toBe(false);
    expect(errors).toEqual([]);
  }finally{sockets.forEach(socket=>socket.disconnect());}
});

test('six-player lobby rejects a seventh participant while the browser can leave and rejoin',async({page})=>{
  const sockets:Socket[]=[];const room=`chairs-cap-${Date.now()}`;
  try{
    await enter(page,'主持',room);await page.getByRole('button',{name:'派对游戏',exact:true}).click();
    await page.getByRole('button',{name:'报名参加',exact:true}).click();
    for(let i=0;i<5;i++){const socket=await peer(room,`伙伴${i+1}`,sockets);expect((await emit(socket,'minigame',{action:'join'})).ok).toBe(true);}
    const seventh=await peer(room,'第七人',sockets);expect((await emit(seventh,'minigame',{action:'join'})).ok).toBe(false);
    expect((await snapshot(seventh)).minigame?.participants).toHaveLength(6);
    await expect(page.getByTestId('party-panel')).toContainText('6');
    await page.getByRole('button',{name:'退出报名',exact:true}).click();
    await expect.poll(async()=>(await snapshot(seventh)).minigame?.participants.length).toBe(5);
    await page.getByRole('button',{name:'报名参加',exact:true}).click();
    await expect.poll(async()=>(await snapshot(seventh)).minigame?.participants.length).toBe(6);
  }finally{sockets.forEach(socket=>socket.disconnect());}
});

test.describe('phone',()=>{
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
test('390px phone shows the game entry, readable rules and working signup without overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await enter(page,'手机玩家',`phone-${Date.now()}`);
  await page.getByRole('button',{name:'派对游戏',exact:true}).click();
  const panel=page.getByTestId('party-panel');await expect(panel).toBeVisible();
  await expect(panel).toContainText('抢凳子');await expect(panel).toContainText('3');await expect(panel).toContainText('6');
  await expect(panel).toContainText('音乐');await expect(panel).toContainText('走动');
  await page.getByRole('button',{name:'报名参加',exact:true}).click();
  await expect(page.getByRole('button',{name:'退出报名',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'开始游戏',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const bounds=await panel.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(391);
  await page.screenshot({path:'artifacts/minigames-phone-rules.png'});
  await page.getByRole('button',{name:'关闭派对游戏',exact:true}).click();await expect(panel).toBeHidden();
  await expect(page.getByRole('button',{name:'移动摇杆',exact:true})).toBeVisible();
});

test('phone joystick contributes real movement and the active HUD fits a small landscape',async({page,context})=>{
  const sockets:Socket[]=[],room=`touch-${Date.now()}`;
  try{
    await enter(page,'触屏玩家',room);
    const second=await peer(room,'手机伙伴一',sockets),third=await peer(room,'手机伙伴二',sockets);
    await page.getByRole('button',{name:'派对游戏',exact:true}).click();
    await page.getByRole('button',{name:'报名参加',exact:true}).click();
    expect((await emit(second,'minigame',{action:'join'})).ok).toBe(true);
    expect((await emit(third,'minigame',{action:'join'})).ok).toBe(true);
    await page.getByRole('button',{name:'开始游戏',exact:true}).click();
    await waitPhase(second,'music',1);
    await expect(page.locator('.interaction-prompt')).toHaveCount(0);
    const joystick=page.getByRole('button',{name:'移动摇杆',exact:true});
    const box=(await joystick.boundingBox())!;
    const cdp=await context.newCDPSession(page),x=box.x+box.width/2,y=box.y+box.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+33,y,id:1}]});
    await page.waitForTimeout(1000);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(async()=>{const state=await snapshot(second),id=Object.values(state.players).find(p=>p.name==='触屏玩家')!.id;return state.minigame?.movement[id]?.eligible;}).toBe(true);
    await page.setViewportSize({width:568,height:320});
    const hud=page.getByTestId('party-status');await expect(hud).toBeVisible();
    const bounds=(await hud.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(260);
    expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(569);
    expect(bounds.y+bounds.height).toBeLessThan(250);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'artifacts/minigames-phone-landscape.png'});
  }finally{sockets.forEach(socket=>socket.disconnect());}
});
});
