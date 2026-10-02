// Deterministic signal fixture through the real VoiceChat/WebRTC pipeline; no physical-microphone claims.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),baseURL=process.env.VOICE_TEST_URL||'http://localhost:5173';
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const contexts=[],errors=[],report={timestamp:new Date().toISOString(),baseURL,browser:browser.version(),source:'Deterministic voiced-tone/noise fixture through production VoiceChat DSP, real Edge WebRTC and Socket.IO. Capture constraints checked against the fake device. Physical microphone quality is not measured.',passed:false};
async function stats(page){return page.evaluate(async()=>{const out=[];for(const pc of window.audit.pcs)for(const s of(await pc.getStats()).values())if(s.kind==='audio'&&['inbound-rtp','outbound-rtp'].includes(s.type))out.push({type:s.type,bytesReceived:s.bytesReceived,packetsReceived:s.packetsReceived,bytesSent:s.bytesSent,totalAudioEnergy:s.totalAudioEnergy});return out;});}
async function sample(page,position,forward=[0,0,-1]){return page.evaluate(async({position,forward})=>{const a=window.audit;a.chat.setListenerPose(position,forward);await new Promise(r=>setTimeout(r,800));let left=0,right=0,peak=0;const data=new Float32Array(2048);for(let n=0;n<10;n++){for(const [i,meter]of a.meters.entries()){meter.getFloatTimeDomainData(data);let sum=0;for(const v of data){sum+=v*v;peak=Math.max(peak,Math.abs(v));}if(i===0)left+=sum/data.length;else right+=sum/data.length;}await new Promise(r=>setTimeout(r,20));}return{left:Math.sqrt(left/10),right:Math.sqrt(right/10),rms:Math.sqrt((left+right)/20),peak};},{position,forward});}
let phase='setup';const watchdog=setTimeout(()=>{console.error('Voice audit timed out in '+phase);void browser.close();},60000);
try{
 const pages=[],roomId='voice-spatial-'+Date.now();
 for(let index=0;index<2;index++){
  const context=await browser.newContext({permissions:['microphone']});contexts.push(context);const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));await page.goto(baseURL);console.log('Voice audit: joining peer '+index);
  await page.evaluate(async({roomId,index})=>{
   const {VoiceChat}=await import('/src/audio/VoiceChat.ts'),{io}=await import('/node_modules/.vite/deps/socket__io-client.js');const audioContext=new AudioContext();await audioContext.resume();
   const a=window.audit={pcs:[],captures:0,statuses:[],errors:[],audioContext,id:'',state:null},NativePeer=window.RTCPeerConnection;
   window.RTCPeerConnection=class extends NativePeer{constructor(config){super(config);a.pcs.push(this);}};
   const nativeCapture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   navigator.mediaDevices.getUserMedia=async constraints=>{
    a.captures++;a.constraints=constraints;const device=await nativeCapture(constraints);a.deviceSettings=device.getAudioTracks()[0].getSettings();device.getTracks().forEach(t=>t.stop());
    const fixture=new AudioContext(),destination=fixture.createMediaStreamDestination();await fixture.resume();const tone=fixture.createOscillator(),toneGain=fixture.createGain();tone.frequency.value=620;toneGain.gain.value=.12;tone.connect(toneGain);toneGain.connect(destination);tone.start();
    const noise=fixture.createBufferSource(),noiseGain=fixture.createGain(),buffer=fixture.createBuffer(1,fixture.sampleRate,fixture.sampleRate);let seed=12345;const data=buffer.getChannelData(0);for(let n=0;n<data.length;n++){seed=(1664525*seed+1013904223)>>>0;data[n]=seed/2147483648-1;}noise.buffer=buffer;noise.loop=true;noiseGain.gain.value=.001;noise.connect(noiseGain);noiseGain.connect(destination);noise.start();
    a.fixture={context:fixture,tone,toneGain,noiseGain};return destination.stream;
   };
   const socket=a.socket=io({autoConnect:false}),chat=a.chat=new VoiceChat(socket,audioContext,s=>a.statuses.push(s),e=>a.errors.push(e),()=>{});await chat.configure();socket.on('state',state=>{a.state=state;if(a.id)chat.setState(state,a.id);});
   await new Promise((resolve,reject)=>{socket.on('connect',()=>socket.timeout(5000).emit('join',{roomId,name:'Voice '+index},(error,result)=>{if(error||!result?.ok){reject(new Error(result?.error||'join timeout'));return;}a.id=result.id;a.state=result.state;chat.setState(result.state,result.id);resolve();}));socket.connect();});
   const splitter=audioContext.createChannelSplitter(2);chat.master.connect(splitter);a.meters=[0,1].map(channel=>{const meter=audioContext.createAnalyser();meter.fftSize=2048;splitter.connect(meter,channel);return meter;});
  },{roomId,index});
 }
 phase='connecting';console.log('Voice audit: waiting for WebRTC');for(const page of pages)await page.waitForFunction(()=>window.audit.pcs.some(pc=>pc.connectionState==='connected'),{},{timeout:20000});
 report.beforeMicrophones=await Promise.all(pages.map(page=>page.evaluate(()=>({captures:window.audit.captures,peerConnections:window.audit.pcs.length}))));
 assert.deepEqual(report.beforeMicrophones.map(v=>v.captures),[0,0]);assert.deepEqual(report.beforeMicrophones.map(v=>v.peerConnections),[1,1]);
 phase='microphone';console.log('Voice audit: enabling fixture');await pages[0].evaluate(()=>window.audit.chat.enable());await pages[0].waitForFunction(()=>window.audit.statuses.at(-1)==='on');
 await pages[1].waitForFunction(()=>Object.values(window.audit.state.players).some(p=>p.id!==window.audit.id&&p.mic));
 const origin=await pages[0].evaluate(()=>{const p=window.audit.state.players[window.audit.id];return[p.position[0],p.position[1]+1,p.position[2]];}),pose=(x,z=0)=>[origin[0]+x,origin[1],origin[2]+z];
 await pages[1].evaluate(()=>{const a=window.audit,d=a.audioContext.createMediaStreamDestination();a.chat.master.connect(d);a.recording={chunks:[],recorder:new MediaRecorder(d.stream,{mimeType:'audio/webm;codecs=opus'})};a.recording.recorder.ondataavailable=e=>{if(e.data.size)a.recording.chunks.push(e.data);};a.recording.recorder.start();});
 phase='spatial output';console.log('Voice audit: measuring output');report.nearLeft=await sample(pages[1],pose(2));report.nearRight=await sample(pages[1],pose(-2));report.turnedAround=await sample(pages[1],pose(2),[0,0,1]);report.far=await sample(pages[1],pose(7.5));report.outsideRange=await sample(pages[1],pose(12));
 assert.ok(report.nearLeft.rms>.005,'decoded sound must be audible');assert.ok(report.nearLeft.left>report.nearLeft.right*1.3,'speaker on left must favour left channel');assert.ok(report.nearRight.right>report.nearRight.left*1.3,'speaker on right must favour right channel');assert.ok(report.turnedAround.right>report.turnedAround.left*1.3,'turning listener must reverse left/right');assert.ok(report.far.rms<report.nearLeft.rms*.15,'distance must substantially reduce voice');assert.ok(report.outsideRange.rms<report.nearLeft.rms*.001,'beyond nine metres must become silent');
 report.receiverCapturesWhileListening=await pages[1].evaluate(()=>window.audit.captures);assert.equal(report.receiverCapturesWhileListening,0);
 report.elementBypass=await pages[1].evaluate(()=>[...document.querySelectorAll('audio[data-peer]')].some(a=>!a.muted||a.volume!==0));assert.equal(report.elementBypass,false);
 await pages[0].evaluate(()=>{window.audit.fixture.toneGain.gain.value=0;window.audit.chat.setNoiseGateThreshold(-60);});report.noiseSensitive=await sample(pages[1],pose(0,1));
 await pages[0].evaluate(()=>window.audit.chat.setNoiseGateThreshold(-48));report.noiseDefault=await sample(pages[1],pose(0,1));assert.ok(report.noiseDefault.rms<report.noiseSensitive.rms*.65,'soft gate must attenuate controlled noise');
 await pages[0].evaluate(()=>{const a=window.audit;a.fixture.toneGain.gain.value=.12;a.fixture.noiseGain.gain.value=0;a.fixture.tone.frequency.value=30;a.chat.setNoiseGateThreshold(-60);});report.lowRumble=await sample(pages[1],pose(0,1));await pages[0].evaluate(()=>{window.audit.fixture.tone.frequency.value=620;});report.voiceReference=await sample(pages[1],pose(0,1));assert.ok(report.lowRumble.rms<report.voiceReference.rms*.25,'high-pass filtering must reduce low-frequency rumble');
 await pages[0].evaluate(()=>{window.audit.chat.setNoiseGateThreshold(-48);window.audit.fixture.toneGain.gain.value=.9;});report.loudInput=await sample(pages[1],pose(0,1));assert.ok(report.loudInput.peak<.85,'loud input must retain output headroom');
 await pages[0].evaluate(()=>{window.audit.fixture.toneGain.gain.value=.12;});await pages[1].evaluate(()=>window.audit.chat.enable());await pages[1].waitForFunction(()=>window.audit.statuses.at(-1)==='on');
 const rtpDeadline=Date.now()+10000;do{report.bidirectionalRtp=await Promise.all(pages.map(stats));if(report.bidirectionalRtp.every(list=>list.some(s=>s.type==='inbound-rtp'&&s.bytesReceived>1000)))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<rtpDeadline);assert.ok(report.bidirectionalRtp.every(list=>list.some(s=>s.type==='inbound-rtp'&&s.bytesReceived>1000)),'both peers must receive real audio RTP');
 await pages[0].evaluate(()=>window.audit.chat.disable());await pages[1].waitForFunction(()=>Object.values(window.audit.state.players).filter(p=>p.id!==window.audit.id).every(p=>!p.mic));report.disabled=await sample(pages[1],pose(0,1));assert.ok(report.disabled.rms<.00001);
 report.captureSettings=await pages[0].evaluate(()=>({requested:window.audit.constraints.audio,obtained:window.audit.deviceSettings}));assert.equal(report.captureSettings.requested.autoGainControl,false);
 report.chatErrors=await Promise.all(pages.map(page=>page.evaluate(()=>window.audit.errors)));assert.deepEqual(report.chatErrors,[[],[]]);assert.deepEqual(errors,[]);
 const bytes=await pages[1].evaluate(async()=>{const r=window.audit.recording;await new Promise(resolve=>{r.recorder.onstop=resolve;r.recorder.stop();});return[...new Uint8Array(await new Blob(r.chunks,{type:'audio/webm'}).arrayBuffer())];});
 const audioPath=resolve(projectRoot,'artifacts/voice-spatial.webm');await mkdir(dirname(audioPath),{recursive:true});await writeFile(audioPath,Buffer.from(bytes));report.audioSample=audioPath;report.passed=true;
}catch(e){report.failure=e instanceof Error?e.message:String(e);process.exitCode=1;}finally{
 clearTimeout(watchdog);phase='cleanup';report.pageErrors=errors;for(const context of contexts)await context.close();await browser.close();const artifact=resolve(projectRoot,'artifacts/voice-media.json');await mkdir(dirname(artifact),{recursive:true});await writeFile(artifact,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));console.log('Media verification report: '+artifact);
}

