import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const url=process.env.PUBLIC_URL??'https://124.221.108.122';
const browser=await chromium.launch({channel:'msedge',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({permissions:['microphone'],viewport:{width:1440,height:1000}});
const errors=[],report={url,checks:{},relays:[]};
try {
  const probe=await context.newPage();
  if(process.env.VERIFY_RELOAD==='1')await probe.exposeFunction('reload407',async()=>{
    await promisify(execFile)('ssh.exe',['-i','C:/Users/yby20/.ssh/id_ed25519_407_deploy_20261001','-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','infinity@124.221.108.122','set -e; cd /home/infinity/apps/407-choir; docker compose -f deploy/compose.yaml run --rm --entrypoint sh certbot -c "touch /etc/letsencrypt/.reload-needed"; /bin/sh deploy/renew.sh'],{timeout:60000});
  });
  await probe.goto(url);
  assert.equal(await probe.evaluate(()=>isSecureContext),true);
  const health=await(await context.request.get(url+'/api/health')).json();assert.equal(health.ok,true);
  const layout=await(await context.request.get(url+'/assets/interaction-layout.json')).json();assert.equal(layout.revision,'20260930_v3');
  report.checks.https=true;report.checks.modelRevision=layout.revision;
  for(const transport of ['udp','tcp','tls']) {
    const result=await probe.evaluate(async transport=>{
      const config=await(await fetch('/api/config')).json();
      const source=config.iceServers.find(server=>server.username);
      const endpoint=source.urls.find(endpoint=>transport==='tls'?endpoint.startsWith('turns:'):endpoint.startsWith('turn:')&&endpoint.endsWith('transport='+transport));
      if(!endpoint)throw new Error('Missing relay endpoint');
      const ice={iceServers:[{...source,urls:[endpoint]}],iceTransportPolicy:'relay'};
      const a=new RTCPeerConnection(ice),b=new RTCPeerConnection(ice),pendingA=[],pendingB=[];
      a.onicecandidate=event=>{if(event.candidate){if(b.remoteDescription)void b.addIceCandidate(event.candidate);else pendingB.push(event.candidate);}};
      b.onicecandidate=event=>{if(event.candidate){if(a.remoteDescription)void a.addIceCandidate(event.candidate);else pendingA.push(event.candidate);}};
      let timer,remoteChannel;
      try {
        const channel=a.createDataChannel('407-relay-check');
        const received=new Promise((resolve,reject)=>{
          timer=setTimeout(()=>reject(new Error('Relay '+transport+' connection timeout')),30000);
          b.ondatachannel=event=>{remoteChannel=event.channel;event.channel.onmessage=message=>{if(message.data==='407-hello')resolve(true);};};
          channel.onopen=()=>channel.send('407-hello');
        });
        await a.setLocalDescription(await a.createOffer());await b.setRemoteDescription(a.localDescription);
        for(const candidate of pendingB)await b.addIceCandidate(candidate);
        await b.setLocalDescription(await b.createAnswer());await a.setRemoteDescription(b.localDescription);
        for(const candidate of pendingA)await a.addIceCandidate(candidate);
        await received;
        let reloadPreserved;
        if(transport==='tls'&&window.reload407){
          await window.reload407();
          await new Promise((resolve,reject)=>{
            clearTimeout(timer);timer=setTimeout(()=>reject(new Error('TLS relay stopped after certificate reload')),10000);
            remoteChannel.onmessage=message=>{if(message.data==='407-after-reload')resolve(true);};
            channel.send('407-after-reload');
          });
          reloadPreserved=a.connectionState==='connected'&&b.connectionState==='connected';
          if(!reloadPreserved)throw new Error('Certificate reload interrupted relay connection');
        }
        const stats=await a.getStats();let selected;
        stats.forEach(stat=>{if(stat.type==='transport'&&stat.selectedCandidatePairId)selected=stats.get(stat.selectedCandidatePairId);});
        const candidate=selected&&stats.get(selected.localCandidateId);
        if(candidate?.candidateType!=='relay')throw new Error('Probe did not use a relay candidate');
        return {transport,candidateType:candidate.candidateType,relayProtocol:candidate.relayProtocol,received:true,...(reloadPreserved?{certificateReloadPreservedConnection:true}:{})};
      } finally {clearTimeout(timer);a.close();b.close();}
    },transport);
    report.relays.push(result);console.log('TURN '+transport+' verified');
  }
  await probe.close();
  await context.addInitScript(()=>{
    const Native=window.RTCPeerConnection;window.__choirPeers=[];
    window.RTCPeerConnection=class extends Native {constructor(config){super({...config,iceTransportPolicy:'relay'});window.__choirPeers.push(this);}};
  });
  const p1=await context.newPage(),p2=await context.newPage(),room='public-'+Date.now();
  for(const page of [p1,p2])page.on('pageerror',error=>errors.push(error.message));
  const enter=async(page,name)=>{
    await page.goto(url);await page.getByLabel('你的昵称').fill(name);await page.getByLabel('房间号',{exact:true}).fill(room);
    await page.getByRole('button',{name:'走，去小屋'}).click();await expect(page.locator('.room-dock')).toBeVisible();await expect(page.locator('.room-loading')).toHaveCount(0,{timeout:180000});
    console.log(name+' entered public room');
  };
  await enter(p1,'公网测试一');await enter(p2,'公网测试二');
  await expect(p1.getByText('2 位伙伴在这里')).toBeVisible();
  await p1.getByRole('button',{name:'开启麦克风',exact:true}).click();await expect(p1.getByRole('button',{name:'麦克风已开启'})).toBeVisible();
  await expect.poll(()=>p2.evaluate(async()=>{
    let total=0;for(const peer of window.__choirPeers){const stats=await peer.getStats();stats.forEach(stat=>{if(stat.type==='inbound-rtp'&&stat.kind==='audio')total+=stat.bytesReceived??0;});}return total;
  }),{timeout:30000}).toBeGreaterThan(0);
  report.checks.realAppRelayedAudio=true;
  await p1.getByRole('button',{name:'聊天',exact:true}).click();await p1.getByRole('textbox',{name:'聊天内容'}).fill('公网联机测试');await p1.getByRole('textbox',{name:'聊天内容'}).press('Enter');
  await expect(p2.locator('.world-labels .speech-bubble').filter({hasText:'公网联机测试'})).toBeVisible();
  await p1.getByRole('textbox',{name:'聊天内容'}).press('Escape');
  await p1.screenshot({path:'artifacts/public-room-desktop.png'});
  await p1.locator('.room-places button').filter({hasText:'窗边立式钢琴'}).click();await expect(p1.locator('.piano-panel')).toBeVisible({timeout:60000});
  await p1.getByRole('button',{name:'琴键 60',exact:true}).dispatchEvent('pointerdown',{pointerId:1});await p1.getByRole('button',{name:'琴键 60',exact:true}).dispatchEvent('pointerup',{pointerId:1});
  await p1.getByRole('button',{name:'结束演奏',exact:true}).click();
  await p2.setViewportSize({width:390,height:844});await expect(p2.getByRole('button',{name:'移动摇杆'})).toBeVisible();
  await p2.screenshot({path:'artifacts/public-room-mobile.png'});
  assert.equal(await p2.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);report.checks.multiplayerChatAndPiano=true;report.checks.mobileLayout=true;report.pageErrors=errors;
  console.log('Public website, microphone, relayed audio and multiplayer verified');
} finally {
  await writeFile('artifacts/public-verification.json',JSON.stringify(report,null,2));
  await browser.close();
}
