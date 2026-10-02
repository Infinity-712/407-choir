import test from 'node:test';
import assert from 'node:assert/strict';
import { SoftVoiceGate, voiceDistanceGain, voicePosition } from '../shared/voice-spatial.ts';

test('nearby voice stays clear while distant voice fades continuously to silence',()=>{
  assert.equal(voiceDistanceGain(0),1);assert.equal(voiceDistanceGain(1.5),1);
  assert.ok(voiceDistanceGain(3)<.5);assert.ok(voiceDistanceGain(7)<.1);
  assert.equal(voiceDistanceGain(9),0);assert.equal(voiceDistanceGain(20),0);
  let previous=1;for(let d=1.5;d<=10;d+=.02){const gain=voiceDistanceGain(d);assert.ok(gain<=previous+1e-12&&gain>=0);assert.ok(previous-gain<.025);previous=gain;}
});
test('voice source height follows standing and sitting ear positions',()=>{
  assert.deepEqual(voicePosition({position:[2,.4,3],mode:'walk'}),[2,1.4,3]);
  assert.deepEqual(voicePosition({position:[2,.7,3],mode:'sit'}),[2,1.35,3]);
});
test('soft noise gate reduces background hiss without cutting syllable tails',()=>{
  const gate=new SoftVoiceGate();
  assert.ok(gate.gain(.0005,0)<.2);
  assert.equal(gate.gain(.04,.02),1);
  assert.equal(gate.gain(.0005,.15),1,'a short pause must retain the speech tail');
  assert.ok(gate.gain(.0005,.3)<.2);
  assert.ok(gate.gain(0,.6)>0,'quiet speech is attenuated rather than cut to zero');
});
test('higher microphone sensitivity admits quieter voices and gate reset drops stale hold',()=>{
  const gate=new SoftVoiceGate();gate.setThreshold(-60);assert.equal(gate.gain(.002,0),1);
  gate.reset();gate.setThreshold(-30);assert.ok(gate.gain(.002,.01)<.2);
  gate.setThreshold(Infinity);assert.equal(gate.threshold,-30);
});
