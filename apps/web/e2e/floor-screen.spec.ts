/**
 * @module 책임: 하한선 자리가 휴대폰·데스크톱 폭에서 문서를 가로로 밀지 않고, 요약·세 탭·1~10등 층·넣을 값 칸이 fixture 그대로
 * 동작하는지 검사한다. 이 route는 RSC가 서버에서 세 조회를 부르므로 fixture 서버가 응답한다.
 */
import { expect, test } from '@playwright/test';

import { NO_BIDS_SESSION_VALUE } from './support/floor-lines-fixture';
import { SESSION_COOKIE_NAME } from './support/session-fixture';
import { VIEWPORT_WIDTH } from './support/viewports';

const WIDTHS = [VIEWPORT_WIDTH.phone, VIEWPORT_WIDTH.md, VIEWPORT_WIDTH.designCanvas] as const;

async function noSideScroll(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const width of WIDTHS) {
  test(`${width}px 폭에서 하한선 자리가 요약과 세 탭을 그리고 문서를 가로로 밀지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/floor?region=459');
    await expect(page.getByRole('heading', { name: '하한선 자리', level: 1 })).toBeVisible();
    // 건수는 오늘 날짜로 정해지는 1년 창에 따라 바뀐다. 표본이 그 창 안에 있는지만 본다.
    await expect(page.getByLabel('요약')).toContainText(/경남 김해시 · 최근 1년 하한율 90% 공고 [\d,]+건/);
    await expect(page.getByLabel('요약')).toContainText('이 안에 넣으면 된다는 뜻이 아니에요');
    await expect(page.getByRole('img', { name: /하한선 점 그림/ })).toBeVisible();
    await noSideScroll(page);
    await page.getByRole('tab', { name: '달별' }).click();
    await expect(page.getByRole('table')).toContainText('가장 많이 나온 칸(사정률)');
    await expect(page.getByRole('heading', { name: '몰린 칸을 따라 넣으면 맞을까?' })).toBeVisible();
    await noSideScroll(page);
    await page.getByRole('tab', { name: '넣을 값 따져 보기' }).click();
    await expect(page.getByRole('heading', { name: '이 값으로 넣으면' })).toBeVisible();
    await noSideScroll(page);
  });
}

test('지역이 없고 내 업체 투찰도 없으면 고르라고 말하고, 시군구를 고르면 주소에 지역이 남는다', async ({ page, context }) => {
  await context.addCookies([{ name: SESSION_COOKIE_NAME, value: NO_BIDS_SESSION_VALUE, domain: '127.0.0.1', path: '/' }]);
  await page.goto('/floor');
  await expect(page.getByText('어느 지역 공고를 볼까요?')).toBeVisible();
  await page.getByLabel('시도').selectOption({ label: '경남' });
  await page.getByLabel('시군구').selectOption({ label: '김해시 (240건)' });
  await expect(page).toHaveURL(/region=459/);
  await expect(page.getByLabel('요약')).toContainText('경남 김해시');
});

test('1~10등 층은 주소에 남아 다시 조회하고, 탭은 주소에 남는다', async ({ page }) => {
  await page.goto('/floor?region=459');
  await page.getByRole('button', { name: '실제 투찰 1~10등' }).click();
  await expect(page).toHaveURL(/ranks=true/);
  await expect(page.getByRole('button', { name: '실제 투찰 1~10등' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: '달별' }).click();
  await expect(page).toHaveURL(/view=months/);
});

test('넣을 값은 사정률과 기초금액 대비 % 사이를 오가도 같은 값을 가리킨다', async ({ page }) => {
  await page.goto('/floor?region=459&view=rule');
  // 빈칸에서 시작한다. 미리 채운 값은 권하는 값으로 읽힌다.
  await expect(page.getByRole('spinbutton', { name: /넣을 값/ })).toHaveValue('');
  await page.getByRole('spinbutton', { name: /넣을 값/ }).fill('100.000');
  const result = page.locator('[aria-live="polite"]').filter({ hasText: '하한 미달이 되는 건' });
  await expect(result).toContainText('사정률 100.000(기초금액의 90.000%)');
  await page.getByRole('button', { name: '기초금액 대비 %' }).click();
  await expect(page.getByRole('spinbutton', { name: /넣을 값/ })).toHaveValue('90.000');
  await page.getByRole('spinbutton', { name: /넣을 값/ }).fill('89.500');
  await expect(result).toContainText('기초금액의 89.500%');
});

test('주소에 지역이 없으면 내 업체가 가장 많이 넣은 공고지역으로 연다', async ({ page }) => {
  await page.goto('/floor');
  await expect(page.getByLabel('요약')).toContainText('경남 김해시 · 최근 1년');
});

test('오늘 투찰·공고 상세의 입구 줄은 하한선 자리 요약과 같은 범위를 말하고 그 지역으로 연다', async ({ page }) => {
  await page.goto('/auctions/9007199254740993');
  await expect(page.locator('[data-slot="floor-entry"]')).toContainText('이 지역(');
  await page.goto('/work');
  const workEntry = page.locator('[data-slot="floor-entry"]');
  await expect(workEntry).toContainText('김해시 하한선 · 최근 1년 열 번 중 다섯 번은 사정률');
  const range = await workEntry.locator('b').innerText();
  await workEntry.getByRole('link', { name: '하한선 자리 보기 →' }).click();
  await expect(page).toHaveURL(/\/floor\?region=459$/);
  await expect(page.getByLabel('요약').locator('b')).toHaveText(range);
});

test('복기의 입구 줄은 그 달로 확대한 하한선 자리를 열고 보이는 기간 문장이 같은 범위를 말한다', async ({ page }) => {
  await page.goto('/review');
  const entry = page.locator('[data-slot="floor-entry"]');
  await expect(entry).toContainText('9월 김해시 하한율 90% 공고 20건 · 열 번 중 다섯 번은 사정률');
  const range = await entry.locator('b').innerText();
  await entry.getByRole('link', { name: '9월 하한선 보기 →' }).click();
  await expect(page).toHaveURL(/month=2026-09/);
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: '넓게 보면' })).toContainText(`공고 20건: 넓게 보면 열 번 중 다섯 번이 ${range}`);
  await page.getByRole('tab', { name: '달별' }).click();
  await expect(page.getByRole('row', { name: /복기에서 고른 달/ })).toContainText('26년 9월');
});
