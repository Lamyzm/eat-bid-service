/**
 * @module 책임: 넣을 공고가 휴대폰·데스크톱 폭에서 문서를 가로로 밀지 않고, 사업장별 이달 값 카드·넘겨주기·마감일과 하한율 묶음을
 * fixture 그대로 그리는지 검사한다. 이 route는 RSC가 서버에서 공고 한 장과 사업장 목록을 조회하므로 fixture 서버가 응답한다.
 */
import { expect, test } from '@playwright/test';

import { VIEWPORT_WIDTH } from './support/viewports';

const WIDTHS = [VIEWPORT_WIDTH.phone, VIEWPORT_WIDTH.md, VIEWPORT_WIDTH.designCanvas] as const;

for (const width of WIDTHS) {
  test(`${width}px 폭에서 넣을 공고가 값 카드와 마감일 묶음을 그리고 문서를 가로로 밀지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/work');
    await expect(page.getByRole('heading', { name: '넣을 공고', level: 1 })).toBeVisible();
    const values = page.getByRole('region', { name: '10월 값' });
    await expect(values.getByRole('listitem')).toHaveCount(2);
    await expect(values).toContainText('88.641%');
    await expect(values).toContainText('89.028%');
    await expect(page.getByRole('heading', { name: /오늘 9\.22\(화\) 마감/ })).toBeVisible();
    await expect(page.getByRole('table', { name: /하한 88%/ })).toBeVisible();
    await expect(page.getByRole('table', { name: /하한 90%/ }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('넘겨주기는 그 사업장에 보낼 글을 복사하고 누른 자리에서 복사됐다고 알린다', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/work');
  const pass = page.getByRole('button', { name: /900-00-00049에 보낼 값 복사/ });
  await pass.click();
  await expect(pass).toContainText('복사됨');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // Windows 클립보드는 줄바꿈을 CRLF로 바꿔 돌려준다. 글의 뜻만 견준다.
  expect(copied.replaceAll('\r\n', '\n')).toBe('900-00-00049 10월 값\n하한 90%: 89.028%');
});
