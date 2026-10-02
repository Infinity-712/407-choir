import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraGestures} from '../src/scene/CameraGestures.ts';
test('camera taps select but drags do not accidentally walk',()=>{const g=new CameraGestures();g.down(1,100,100);assert.equal(g.up(1),true);g.down(1,100,100);assert.deepEqual(g.move(1,120,110),{dx:20,dy:10,zoom:0});assert.equal(g.up(1),false);});
test('pinch spread zooms in and lifting either finger never clicks furniture',()=>{const g=new CameraGestures();g.down(1,100,100);g.down(2,200,100);assert.equal(g.move(2,240,100)?.zoom,-40);assert.equal(g.up(1),false);assert.deepEqual(g.move(2,250,100),{dx:10,dy:0,zoom:0});assert.equal(g.up(2),false);});
test('cancelled touch releases the camera gesture',()=>{const g=new CameraGestures();g.down(1,100,100);g.cancel();assert.equal(g.active,false);assert.equal(g.up(1),false);g.down(2,200,100);assert.equal(g.up(2),true);});
