import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page, name: string, room: string) {
  await page.goto('/');
  await page.getByLabel('你的昵称').fill(name);
  await page.getByLabel('房间号', { exact: true }).fill(room);
  await page.getByRole('button', { name: '走，去小屋' }).click();
  await expect(page.locator('.room-dock')).toBeVisible();
  await expect(page.locator('.room-loading')).toHaveCount(0, { timeout: 60000 });
}

test('choir poses toggle and typed bubbles share style, remain text, and expire for both people', async ({ browser }) => {
  test.setTimeout(120000);
  const first = await browser.newContext(), second = await browser.newContext();
  const a = await first.newPage(), b = await second.newPage();
  const errors: string[] = [];
  a.on('pageerror', e => errors.push(e.message)); b.on('pageerror', e => errors.push(e.message));
  try {
    const room = `social-${Date.now()}`;
    await enter(a, '小桃', room); await enter(b, '小杏', room);
    await a.getByRole('button', { name: '表情动作', exact: true }).click();
    const held = a.getByRole('button', { name: '双臂抬起', exact: true });
    await held.click(); await expect(held).toHaveAttribute('aria-pressed', 'true');
    await a.waitForTimeout(1800);
    await a.screenshot({ path: 'artifacts/social-held-pose.png' });
    await a.getByRole('button', { name: '关闭动作', exact: true }).click();
    await a.screenshot({ path: 'artifacts/social-held-pose-clear.png' });
    await a.getByRole('button', { name: '表情动作', exact: true }).click();
    await held.click(); await expect(held).toHaveAttribute('aria-pressed', 'false');
    await a.getByRole('button', { name: '聊天', exact: true }).click();
    const input = a.getByRole('textbox', { name: '聊天内容' });
    await input.fill('<b>准备好啦</b> 🎵');
    // The IME confirmation Enter must not send or dismiss the composer.
    await input.dispatchEvent('compositionstart');
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    await expect(b.locator('.speech-bubble').filter({ hasText: '准备好啦' })).toHaveCount(0);
    await input.dispatchEvent('compositionend');
    await a.locator('.chat-appearance summary').click();
    await a.getByRole('button', { name: '薄荷绿', exact: true }).click();
    await a.getByRole('button', { name: '云朵气泡', exact: true }).click();
    await a.getByRole('button', { name: '发送消息', exact: true }).click();
    const localBubble = a.locator('.world-labels .speech-bubble').filter({ hasText: '<b>准备好啦</b> 🎵' });
    const remoteBubble = b.locator('.world-labels .speech-bubble').filter({ hasText: '<b>准备好啦</b> 🎵' });
    await expect(localBubble).toBeVisible(); await expect(remoteBubble).toBeVisible();
    await expect(remoteBubble).toHaveAttribute('data-palette', 'mint');
    await expect(remoteBubble).toHaveAttribute('data-shape', 'cloud');
    await expect(remoteBubble.locator('b')).toHaveCount(0);
    const bubbleBox = await remoteBubble.boundingBox();
    const nameBox = await remoteBubble.locator('..').locator('.person-name').boundingBox();
    expect(bubbleBox!.y + bubbleBox!.height).toBeLessThanOrEqual(nameBox!.y + 1);
    await expect.poll(async () => {
      const bubble = await remoteBubble.boundingBox();
      const other = await b.locator('.person-label.self .person-name').boundingBox();
      return !!bubble && !!other && (bubble.x + bubble.width <= other.x || other.x + other.width <= bubble.x || bubble.y + bubble.height <= other.y || other.y + other.height <= bubble.y);
    }).toBe(true);
    await b.waitForTimeout(250);
    await b.screenshot({ path: 'artifacts/social-shared-bubble.png' });
    await expect(remoteBubble).toBeHidden({ timeout: 12000 });
    await expect(localBubble).toBeHidden();
    await input.press('Escape');
    await a.getByRole('button', { name: '聊天', exact: true }).click();
    await a.locator('.chat-appearance summary').click();
    await expect(a.getByRole('button', { name: '薄荷绿', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(a.getByRole('button', { name: '云朵气泡', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await input.press('Escape');
    await a.locator('.room-places button').filter({ hasText: '黑色钢琴' }).click();
    await expect(a.locator('.piano-panel')).toBeVisible({ timeout: 30000 });
    await a.getByRole('button', { name: '聊天', exact: true }).click();
    await a.getByRole('textbox', { name: '聊天内容' }).pressSequentially('aws ');
    await expect(a.locator('.piano-key.pressed')).toHaveCount(0);
    await a.getByRole('textbox', { name: '聊天内容' }).press('Escape');
    await expect(a.locator('.piano-panel')).toBeVisible();
    await a.getByRole('button', { name: '结束演奏' }).click();
    await expect(a.locator('.piano-panel')).toHaveCount(0);
    await a.locator('.room-places button').filter({ hasText: '指挥台' }).click();
    await expect(a.locator('.conduct-panel')).toBeVisible({ timeout: 30000 });
    await a.getByRole('button', { name: '三拍', exact: true }).click();
    await a.getByRole('button', { name: '起拍', exact: true }).click();
    await expect(b.locator('.beat-display i')).toHaveCount(3);
    await a.getByRole('button', { name: '渐强', exact: true }).click();
    await a.screenshot({ path: 'artifacts/social-conductor.png' });
    await a.getByRole('button', { name: '收拍', exact: true }).click();
    await expect(b.locator('.beat-display')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await first.close(); await second.close(); }
});

test('mobile composer and held actions fit a narrow screen and send emoji', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await enter(page, '手机小伙伴', `touch-social-${Date.now()}`);
    await page.getByRole('button', { name: '聊天', exact: true }).tap();
    await page.getByRole('textbox', { name: '聊天内容' }).fill('排练开始 ');
    await page.getByRole('button', { name: '音符', exact: true }).tap();
    await page.getByRole('button', { name: '发送消息', exact: true }).tap();
    await expect(page.locator('.world-labels .speech-bubble')).toHaveText('排练开始 🎵');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'artifacts/social-mobile-chat.png' });
    const box = await page.locator('.chat-composer').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.getByRole('textbox', { name: '聊天内容' }).press('Escape');
    await page.getByRole('button', { name: '表情动作', exact: true }).tap();
    await page.getByRole('button', { name: '右手抚左胸', exact: true }).tap();
    await expect(page.getByRole('button', { name: '右手抚左胸', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(1400);
    await page.screenshot({ path: 'artifacts/social-mobile-pose.png' });
    await page.getByRole('button', { name: '关闭动作', exact: true }).tap();
    await page.screenshot({ path: 'artifacts/social-mobile-pose-clear.png' });
    await page.setViewportSize({ width: 780, height: 360 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  } finally { await context.close(); }
});
