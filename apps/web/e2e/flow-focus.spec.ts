import { expect, test } from '@playwright/test';

import { VIEWPORT_WIDTH } from './support/viewports';

const auctionId = process.env.EATBID_E2E_AUCTION_ID ?? '5796468';
const flowUrl = `/auctions/${auctionId}?view=${encodeURIComponent('흐름')}`;

// 화면 폭과 관계없이 같은 캔버스를 키운다. 휴대폰의 직접 진입은 아래에서 별도로 확인한다.
for (const viewport of [
  { width: VIEWPORT_WIDTH.wideDesktop, height: 1080 },
  { width: VIEWPORT_WIDTH.xl, height: 800 },
  { width: VIEWPORT_WIDTH.lg, height: 768 },
  { width: VIEWPORT_WIDTH.sm, height: 812 }
]) {
  test(`${viewport.width}×${viewport.height} 크게보기는 같은 차트에 높이를 돌려주고 원래 보기로 복귀한다`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto(flowUrl);
    const chart = page.locator('[data-slot="flow-canvas"]');
    await expect(chart.locator('canvas').first()).toBeVisible();
    const canvas = await chart.locator('canvas').first().elementHandle();
    const normal = await chart.boundingBox();
    if (!normal || !canvas) throw new Error('차트를 찾을 수 없습니다.');
    const history = page.getByRole('region', { name: '과거 회차', exact: true });
    await page.getByRole('link', { name: '크게 보기', exact: true }).first().click();
    await expect(page.getByRole('link', { name: '작게 보기', exact: true })).toBeVisible();
    await expect(history).toBeHidden();
    // 좁은 폭은 제목·필터·조작부의 줄바꿈을 유지하므로 남는 높이가 작다. 데스크톱의 확대 폭을 강제해
    // 날짜축을 자르지 않는다. 그래도 확대는 어느 폭에서나 일반 보기보다 큰 차트여야 한다.
    await expect.poll(async () => (await chart.boundingBox())!.height).toBeGreaterThan(normal.height + (viewport.width >= VIEWPORT_WIDTH.md ? 40 : 1));
    expect(await canvas.evaluate((node) => node.isConnected)).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const bounds = await chart.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThan(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if (viewport.width >= VIEWPORT_WIDTH.md) {
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height + 1);
    }
    await page.getByRole('link', { name: '작게 보기', exact: true }).click();
    await expect(history).toBeVisible();
    expect(await canvas.evaluate((node) => node.isConnected)).toBe(true);
    await expect.poll(async () => Math.abs((await chart.boundingBox())!.height - normal.height)).toBeLessThan(2);
  });
}

test(`${VIEWPORT_WIDTH.phone}×812 휴대폰에서도 확대 링크와 공유받은 전체보기가 동작한다`, async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: VIEWPORT_WIDTH.phone, height: 812 });
  await page.goto(flowUrl);
  const chart = page.locator('[data-slot="flow-canvas"]');
  await expect(chart.locator('canvas').first()).toBeVisible();
  const normal = (await chart.boundingBox())!.height;

  await expect(page.locator('[data-expand-target="흐름"]')).toBeVisible();
  await expect(page.getByRole('link', { name: '크게 보기', exact: true })).toHaveCount(2);
  await expect(page.locator('[data-expand-target="과거 회차"]')).toBeVisible();

  // 직접 진입도 탐색 공간을 차트에 주며 닫기는 같은 공고의 일반 보기로 돌아간다.
  await page.goto(`${flowUrl}&expand=${encodeURIComponent('흐름')}`);
  await expect(chart.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('region', { name: '과거 회차', exact: true })).toBeHidden();
  await expect.poll(async () => (await chart.boundingBox())!.height).toBeGreaterThan(normal);
  await page.getByRole('link', { name: '작게 보기', exact: true }).click();
  await expect(page).not.toHaveURL(/expand=/);
});

test('확대 중 메뉴 Escape는 메뉴만 닫고 다음 Escape는 같은 필터를 유지하며 복귀한다', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: VIEWPORT_WIDTH.xl, height: 800 });
  await page.goto(`${flowUrl}&expand=${encodeURIComponent('흐름')}`);
  await expect(page.getByRole('link', { name: '작게 보기', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^기간:/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.getByRole('link', { name: '작게 보기', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '과거 회차', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/expand=/);
});

test('선택 회차와 현재 공고의 전역 패널은 확대·닫기 이후에도 같은 차트와 연결된다', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: VIEWPORT_WIDTH.wideDesktop, height: 1080 });
  await page.goto(flowUrl);
  const chart = page.locator('[data-slot="flow-canvas"]');
  await expect(chart.locator('canvas').first()).toBeVisible();
  const canvas = await chart.locator('canvas').first().elementHandle();
  const record = page.getByRole('region', { name: '선택 회차 참여 기록', exact: true });
  await page.getByRole('button', { name: /회차 참여 기록 보기$/ }).nth(1).click();
  await expect(record).toBeVisible();
  const selected = await record.locator('p').filter({ hasText: /회차 / }).textContent();
  await page.getByRole('link', { name: '크게 보기', exact: true }).first().click();
  await expect(page.getByRole('link', { name: '작게 보기', exact: true })).toBeVisible();
  await expect(record).toBeVisible();
  const widthWithPanel = (await chart.boundingBox())!.width;
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(1081);
  const panel = page.locator('[data-slot="responsive-dock"]:visible');
  expect((await panel.boundingBox())!.height).toBe(1080);
  await page.getByRole('button', { name: '보조 패널 닫기', exact: true }).click();
  await expect(record).toBeHidden();
  await expect.poll(async () => (await chart.boundingBox())!.width).toBeGreaterThan(widthWithPanel + 300);
  await page.getByRole('button', { name: '상세 보기', exact: true }).click();
  await page.getByRole('menuitem', { name: '현재 공고 정보', exact: true }).click();
  await expect(page.getByRole('region', { name: '현재 공고 사실', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '상세 보기', exact: true }).click();
  await page.getByRole('menuitem', { name: '선택 회차 기록', exact: true }).click();
  await expect(record.locator('p').filter({ hasText: /회차 / })).toHaveText(selected!);
  await page.getByRole('link', { name: '작게 보기', exact: true }).click();
  await expect(page.getByRole('region', { name: '과거 회차', exact: true })).toBeVisible();
  expect(await canvas!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(record.locator('p').filter({ hasText: /회차 / })).toHaveText(selected!);
});

test('스크롤한 위치에서 확대하고 돌아오면 필터와 원래 문서 위치를 유지한다', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: VIEWPORT_WIDTH.xl, height: 800 });
  const originalUrl = `${flowUrl}&period=${encodeURIComponent('5년')}&floor=all`;
  await page.goto(originalUrl);
  await expect(page.locator('[data-slot="flow-canvas"] canvas').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 120));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(120);
  await page.getByRole('link', { name: '크게 보기', exact: true }).first().click();
  await expect(page.getByRole('link', { name: '작게 보기', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '과거 회차', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(120);
  expect(new URL(page.url()).searchParams.get('period')).toBe('5년');
  expect(new URL(page.url()).searchParams.get('floor')).toBe('all');
});
