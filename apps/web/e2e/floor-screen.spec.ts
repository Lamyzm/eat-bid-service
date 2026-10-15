/**
 * @module 책임: 하한선 자리가 휴대폰·데스크톱 폭에서 문서를 가로로 밀지 않고, 요약·세 탭·1~10등 층·넣을 값 칸이 fixture 그대로
 * 동작하는지 검사한다. 이 route는 RSC가 서버에서 세 조회를 부르므로 fixture 서버가 응답한다.
 */
import { expect, test } from '@playwright/test';

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
    await expect(page.getByLabel('요약')).toContainText('경남 김해시 · 최근 1년 하한율 90% 공고 243건');
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

test('지역이 없으면 고르라고 말하고, 시군구를 고르면 주소에 지역이 남는다', async ({ page }) => {
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
