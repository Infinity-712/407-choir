import test from 'node:test';
import assert from 'node:assert/strict';
import {isFullscreen, isStandalone, toggleFullscreen, type FullscreenDocument} from '../shared/browser-fullscreen.ts';

test('fullscreen request is made in the click task before yielding user activation', async () => {
  let requested = false;
  const element = {requestFullscreen(options?: FullscreenOptions) {
    assert.equal(this, element);
    assert.deepEqual(options, {navigationUI: 'hide'});
    requested = true;
    return Promise.resolve();
  }};
  const result = toggleFullscreen({documentElement: element});
  assert.equal(requested, true);
  assert.equal(await result, 'entered');
});

test('fullscreen toggle exits the current document instead of issuing another entry request', async () => {
  let exited = false;
  const doc: FullscreenDocument = {
    documentElement: {}, fullscreenElement: {},
    exitFullscreen() {assert.equal(this, doc); exited = true; return Promise.resolve();},
  };
  assert.equal(isFullscreen(doc), true);
  assert.equal(await toggleFullscreen(doc), 'exited');
  assert.equal(exited, true);
});

test('older WebKit entry, state and exit are supported with their native receivers', async () => {
  let entered = false;
  let exited = false;
  const element = {webkitRequestFullscreen() {assert.equal(this, element); entered = true;}};
  const doc: FullscreenDocument = {
    documentElement: element,
    webkitExitFullscreen() {assert.equal(this, doc); exited = true;},
  };
  assert.equal(await toggleFullscreen(doc), 'entered');
  assert.equal(entered, true);
  doc.webkitFullscreenElement = element;
  assert.equal(isFullscreen(doc), true);
  assert.equal(await toggleFullscreen(doc), 'exited');
  assert.equal(exited, true);
});

test('unsupported, policy-disabled and rejected fullscreen resolve to a usable fallback', async () => {
  assert.equal(await toggleFullscreen({documentElement: {}}), 'unavailable');
  let disabledRequested = false;
  assert.equal(await toggleFullscreen({fullscreenEnabled: false, documentElement: {
    requestFullscreen() {disabledRequested = true; return Promise.resolve();},
  }}), 'unavailable');
  assert.equal(disabledRequested, false);
  assert.equal(await toggleFullscreen({documentElement: {
    requestFullscreen() {return Promise.reject(new Error('Permission denied'));},
  }}), 'unavailable');
  assert.equal(await toggleFullscreen({documentElement: {
    webkitRequestFullscreen() {throw new Error('Unsupported in this web view');},
  }}), 'unavailable');
});

test('installed web apps are identified independently of element fullscreen', () => {
  assert.equal(isStandalone({navigator: {standalone: true}, matchMedia: () => ({matches: false})}), true);
  assert.equal(isStandalone({navigator: {}, matchMedia: query => ({matches: query === '(display-mode: standalone)'})}), true);
  assert.equal(isStandalone({navigator: {}, matchMedia: query => ({matches: query === '(display-mode: fullscreen)'})}), true);
  assert.equal(isStandalone({navigator: {}, matchMedia: () => ({matches: false})}), false);
  assert.equal(isFullscreen({documentElement: {}}), false);
});
