import test from 'node:test';
import assert from 'node:assert/strict';
import {PerformanceInput} from '../shared/performance-input.ts';
test('a held keyboard note survives releasing a second pointer on the same note',()=>{const input=new PerformanceInput();assert.equal(input.press(60,'key:A'),true);assert.equal(input.press(60,'pointer:1'),false);assert.equal(input.release(60,'pointer:1'),false);assert.deepEqual(input.notes(),[60]);assert.equal(input.release(60,'key:A'),true);assert.deepEqual(input.notes(),[]);});
test('sustain remains active until every input source is released',()=>{const input=new PerformanceInput();assert.equal(input.pedal(true,'space'),true);assert.equal(input.pedal(true,'pointer:1'),false);assert.equal(input.pedal(false,'pointer:1'),false);assert.equal(input.pedal(false,'space'),true);});
test('clear drops stale pointer and keyboard sources without spurious note off',()=>{const input=new PerformanceInput();input.press(62,'key:S');input.pedal(true,'space');input.clear();assert.deepEqual(input.notes(),[]);assert.equal(input.release(62,'key:S'),false);assert.equal(input.pedal(false,'space'),false);});
