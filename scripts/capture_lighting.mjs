import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Render the actual room pipeline from repeatable viewpoints for lighting review.
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://localhost:5173');
  await page.evaluate(async () => {
    const { RoomWorld } = await import('/src/scene/RoomWorld.ts');
    const layout = await (await fetch('/assets/interaction-layout.json')).json();
    document.body.innerHTML = '<div id="lighting-review" style="position:fixed;inset:0"></div>';
    await new Promise((resolve, reject) => {
      window.reviewWorld = new RoomWorld(document.getElementById('lighting-review'), layout, {
        onMove() {}, onSelect() {}, onInteract() {}, onError: reject,
        onLoad(progress) { if (progress === 100) resolve(); },
      });
    });
    const world = window.reviewWorld;
    cancelAnimationFrame(world.frame);
    world.ring.visible = false;
    world.marker.visible = false;
  });
  const tag = process.env.CAPTURE_TAG || 'lighting';
  for (const [name, position, target] of [
    ['preview', [5.35, 1.72, 4.55], [-.6, 1.7, -1.4]],
    ['chairs', [-.6, 2.15, 2.97], [-.6, .85, -.6]],
  ]) {
    await page.evaluate(({ position, target }) => {
      const w = window.reviewWorld;
      w.camera.position.set(...position); w.camera.lookAt(...target);
      w.lighting.render(performance.now());
    }, { position, target });
    await page.screenshot({ path: `artifacts/${tag}-${name}.png` });
  }
  await page.evaluate(() => {
    const w = window.reviewWorld;
    w.setQuality(true);
    w.lighting.render(performance.now());
  });
  await page.screenshot({ path: `artifacts/${tag}-smooth.png` });
  await writeFile(`artifacts/${tag}.json`, JSON.stringify({ errors }, null, 2));
  console.log(JSON.stringify({ errors }));
} finally { await browser.close(); }
