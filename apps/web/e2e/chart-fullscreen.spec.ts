import { expect, test } from '@playwright/test';

import { VIEWPORT_WIDTH } from './support/viewports';

const auctionId = process.env.EATBID_E2E_AUCTION_ID ?? '5796468';
const flowUrl = `/auctions/${auctionId}?view=${encodeURIComponent('흐름')}`;

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'active_theme', value: 'toss', domain: '127.0.0.1', path: '/' }]);
});

for (const viewport of [
  { width: VIEWPORT_WIDTH.designCanvas, height: 900 },
  { width: VIEWPORT_WIDTH.phone, height: 812 }
]) {
  test(`${viewport.width}px 흐름 전체보기는 탐색 공간까지 채우고 같은 캔버스로 복귀한다`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto(flowUrl);
    const canvas = page.locator('[data-slot="flow-canvas"] canvas').first();
    await expect(canvas).toBeVisible();
    const original = await canvas.elementHandle();
    const expand = page.locator('[data-expand-target="흐름"]');
    await expand.click();
    await expect(expand).toHaveText('작게 보기');
    const frame = page.locator('[data-slot="decision-screen"]');
    await expect.poll(() => frame.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    await expect(page.locator('[data-slot="workspace-header"]')).toBeHidden();
    await expect(page.locator('[data-slot="workspace-tool-rail"]')).toBeHidden();
    await expect.poll(async () => (await page.locator('[data-slot="flow-canvas"]').boundingBox())!.height)
      .toBeGreaterThan(viewport.height / 2);
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    await page.mouse.wheel(0, 400);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(expand).toHaveText('크게 보기');
    await expect(expand).toBeFocused();
    await expect(page.locator('[data-slot="workspace-header"]')).toBeVisible();
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
  });
}

test('분포 전체보기는 최대 폭 없이 화면과 남은 높이를 채우고 닫힌다', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const viewport = { width: VIEWPORT_WIDTH.wideDesktop, height: 1080 };
  await page.setViewportSize(viewport);
  await page.goto(`/auctions/${auctionId}?view=${encodeURIComponent('비교집단')}`);
  const expand = page.locator('[data-expand-target="비교집단"]');
  await expand.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
  const table = dialog.getByRole('table');
  await expect(table).toBeVisible();
  expect((await table.boundingBox())!.height).toBeGreaterThan(viewport.height * 0.7);
  await page.screenshot({ path: testInfo.outputPath('분포-전체보기-1920.png') });
  await page.setViewportSize({ width: VIEWPORT_WIDTH.phone, height: 812 });
  await expect.poll(() => dialog.boundingBox()).toEqual({ x: 0, y: 0, width: VIEWPORT_WIDTH.phone, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(VIEWPORT_WIDTH.phone);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();
});

test('창을 회전하고 뒤로 가도 필터·축 확대·범례와 같은 캔버스를 유지한다', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: VIEWPORT_WIDTH.designCanvas, height: 900 });
  await page.goto(`${flowUrl}&period=${encodeURIComponent('5년')}&floor=all`);
  const chart = page.locator('[data-slot="flow-canvas"]');
  const canvas = await chart.locator('canvas').first().elementHandle();
  await expect(chart).toHaveAttribute('data-price-range', /,/);
  await page.getByRole('button', { name: '비율 축 확대', exact: true }).click();
  const range = await chart.getAttribute('data-price-range');
  const runnerUp = page.getByRole('button', { name: '2등', exact: true });
  await runnerUp.click();
  await page.screenshot({ path: testInfo.outputPath('흐름-일반보기-1440.png') });
  await page.locator('[data-expand-target="흐름"]').click();
  await expect(page.getByRole('link', { name: '작게 보기', exact: true })).toBeVisible();
  await expect(chart).toHaveAttribute('data-price-range', range!);
  await expect(runnerUp).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('흐름-전체보기-1440.png') });
  for (const viewport of [
    { width: VIEWPORT_WIDTH.phone, height: 812 },
    { width: VIEWPORT_WIDTH.md, height: 375 }
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.locator('[data-slot="decision-screen"]').boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    const bounds = (await chart.boundingBox())!;
    expect(bounds.height).toBeGreaterThan(100);
    expect(bounds.y + bounds.height).toBeLessThan(viewport.height);
    await expect(chart).toHaveAttribute('data-price-range', range!);
    expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`흐름-전체보기-${viewport.width}.png`) });
  }
  await page.goBack();
  await expect(page.locator('[data-slot="workspace-header"]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('period')).toBe('5년');
  expect(new URL(page.url()).searchParams.get('floor')).toBe('all');
  await expect(chart).toHaveAttribute('data-price-range', range!);
  await expect(runnerUp).toHaveAttribute('aria-pressed', 'true');
});
