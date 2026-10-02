import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveRenderQuality,parseQualityMode} from '../shared/render-quality.ts';

function frames(quality:AdaptiveRenderQuality,ms:number,duration:number){for(let t=0;t<duration;t+=ms)quality.sample(ms,true);}
test('invalid stored quality falls back to auto and explicit standard preserves its settings',()=>{
  assert.equal(parseQualityMode('bad'),'auto');assert.equal(parseQualityMode(null),'auto');
  const quality=new AdaptiveRenderQuality(3,false);quality.setMode('standard');frames(quality,50,15000);
  assert.equal(quality.current.effective,'standard');assert.equal(quality.current.pixelRatio,1.5);
});
test('auto ignores warmup, isolated pauses and hidden time but responds to sustained slow rendering',()=>{
  const quality=new AdaptiveRenderQuality(2,false);
  frames(quality,45,2500);assert.equal(quality.current.effective,'standard');
  quality.sample(8000,false);frames(quality,16,10000);quality.sample(1600,true);
  assert.equal(quality.current.effective,'standard');
  frames(quality,40,7000);assert.equal(quality.current.effective,'smooth');
  assert.equal(quality.current.pixelRatio,1);
});
test('smooth mode can reduce pixels further and only recovers after sustained headroom',()=>{
  const quality=new AdaptiveRenderQuality(2,true);quality.setMode('smooth');
  frames(quality,40,14000);assert.ok(quality.current.pixelRatio<1);
  const low=quality.current.pixelRatio;frames(quality,10,3000);assert.equal(quality.current.pixelRatio,low);
  frames(quality,10,45000);assert.equal(quality.current.effective,'smooth');assert.equal(quality.current.pixelRatio,1);
  quality.setMode('standard');assert.equal(quality.current.effective,'standard');
  quality.setMode('auto');assert.equal(quality.current.effective,'smooth','touch devices start with the existing lightweight lighting');
});
