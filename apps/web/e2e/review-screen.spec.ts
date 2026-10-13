/**
 * @module 책임: 복기 화면이 휴대폰·데스크톱 폭에서 문서를 가로로 밀지 않고, 방법별 성적 표·공고별 눈금자·화면 안 거르기·달 탭이 fixture
 * 그대로 동작하는지 검사한다. 이 route는 RSC가 서버에서 복기 계약을 조회하므로 fixture 서버가 응답한다.
 */
import { expect, test } from '@playwright/test';

import { VIEWPORT_WIDTH } from './support/viewports';

const WIDTHS = [VIEWPORT_WIDTH.phone, VIEWPORT_WIDTH.md, VIEWPORT_WIDTH.designCanvas] as const;
const ROWS = '[data-slot="review-screen"] article';

for (const width of WIDTHS) {
  test(`${width}px 폭에서 복기가 성적 표와 공고 셋을 그리고 문서를 가로로 밀지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/review');
    await expect(page.getByRole('heading', { name: '복기', level: 1 })).toBeVisible();
    await expect(page.locator(ROWS)).toHaveCount(3);
    await expect(page.getByRole('table')).toContainText('9월 맞춤');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('거르기는 화면 안에서 공고를 좁히고, 달 탭은 고른 달을 주소에 남긴다', async ({ page }) => {
  await page.goto('/review');
  await expect(page.locator(ROWS)).toHaveCount(3);
  await page.getByRole('button', { name: /^우리 낙찰/ }).click();
  await expect(page.locator(ROWS)).toHaveCount(1);
  await expect(page.locator(ROWS).first()).toContainText('우리 낙찰');
  await page.getByRole('button', { name: /^8월/ }).click();
  await expect(page).toHaveURL(/month=2026-08/);
});
