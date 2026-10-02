import {chromium, expect} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';

const url=process.env.PERF_URL??'https://124.221.108.122';
const label=process.env.PERF_LABEL??'baseline';
const duration=Number(process.env.PERF_DURATION_MS??10000);
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({channel:'msedge'});
const report={url,label,date:new Date().toISOString(),browser:browser.version(),durationMs:duration,
  caveat:'Headless Edge on this workstation. Mobile viewport, DPR and 4x CPU throttling approximate constrained CPU only, not a physical phone GPU, memory, thermals or network. WebGL instrumentation adds small overhead. Triangle counts include all passes, including shadow maps.',profiles:[]};
const percentile=(values,p)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.floor(a.length*p))]??0;};
const summarize=frames=>({samples:frames.length,elapsedMs:frames.reduce((s,f)=>s+f.ms,0),
  fps:1000*frames.length/frames.reduce((s,f)=>s+f.ms,0),
  frameMsMedian:percentile(frames.map(f=>f.ms),.5),frameMsP95:percentile(frames.map(f=>f.ms),.95),
  drawCallsMedian:percentile(frames.map(f=>f.calls),.5),drawCallsP95:percentile(frames.map(f=>f.calls),.95),
  trianglesMedian:percentile(frames.map(f=>f.triangles),.5),trianglesP95:percentile(frames.map(f=>f.triangles),.95)});
try {
  for(const profile of [{name:'desktop',viewport:{width:1440,height:900},deviceScaleFactor:1,cpu:1},
    {name:'mobile-cpu4',viewport:{width:390,height:844},deviceScaleFactor:2,cpu:4}]) {
    const context=await browser.newContext({viewport:profile.viewport,deviceScaleFactor:profile.deviceScaleFactor,hasTouch:profile.cpu===4,isMobile:profile.cpu===4,ignoreHTTPSErrors:true});
    await context.addInitScript(()=>{
      const probe=window.__perf={record:false,frames:[],calls:0,triangles:0,renderer:null};
      for(const Constructor of [window.WebGLRenderingContext,window.WebGL2RenderingContext].filter(Boolean)){
        for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
          const native=Constructor.prototype[name];if(!native)continue;
          Constructor.prototype[name]=function(...args){
            probe.calls++;
            const count=name.startsWith('drawElements')?args[1]:args[2];
            const instances=name.endsWith('Instanced')?args[name.startsWith('drawElements')?4:3]:1;
            probe.triangles+=(args[0]===4?count/3:(args[0]===5||args[0]===6)?Math.max(0,count-2):0)*instances;
            if(!probe.renderer){const ext=this.getExtension('WEBGL_debug_renderer_info');probe.renderer=ext?this.getParameter(ext.UNMASKED_RENDERER_WEBGL):this.getParameter(this.RENDERER);}
            return native.apply(this,args);
          };
        }
      }
      let previous;
      const sample=now=>{if(previous!==undefined&&probe.record)probe.frames.push({ms:now-previous,calls:probe.calls,triangles:probe.triangles});previous=now;probe.calls=0;probe.triangles=0;requestAnimationFrame(sample);};
      requestAnimationFrame(sample);
    });
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:profile.cpu});
    await page.goto(url);
    console.log(profile.name+' page loaded');
    await page.getByLabel('你的昵称').fill('性能采样');
    await page.getByLabel('房间号',{exact:true}).fill('perf-'+Date.now());
    await page.getByRole('button',{name:'走，去小屋'}).click();
    await expect(page.locator('.room-dock')).toBeVisible({timeout:180000});
    await expect(page.locator('.room-loading')).toHaveCount(0,{timeout:180000});
    console.log(profile.name+' room ready');
    await page.waitForTimeout(8000);
    if(await page.evaluate(()=>document.querySelector('canvas')?.dataset.quality==='smooth')){
      await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.lodReady==='true',{},{timeout:120000});
      await page.waitForTimeout(2000);
    }
    const result={...profile,errors,...await page.evaluate(()=>({renderer:window.__perf.renderer,pointerCoarse:matchMedia('(pointer:coarse)').matches,canvas:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight,dataset:{...c.dataset}}))})),measurements:{}};
    for(const movement of [false,true]){
      if(movement)await page.keyboard.down('w');
      await page.evaluate(()=>{window.__perf.frames=[];window.__perf.record=true;});
      await page.waitForTimeout(duration);
      const frames=await page.evaluate(()=>{window.__perf.record=false;return window.__perf.frames;});
      if(movement)await page.keyboard.up('w');
      const key=movement?'forwardInput':'stationary';
      result.measurements[key]=summarize(frames);
      await writeFile(`artifacts/perf-${label}-${profile.name}-${key}-frames.json`,JSON.stringify(frames));
      if(!movement)await page.screenshot({path:`artifacts/perf-${label}-${profile.name}.png`});
    }
    report.profiles.push(result);console.log(JSON.stringify(result));await context.close();
  }
} finally {await writeFile(`artifacts/perf-${label}.json`,JSON.stringify(report,null,2));await browser.close();}
