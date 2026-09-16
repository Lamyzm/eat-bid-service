import { expect, test } from '@playwright/test';
import { VIEWPORT_WIDTH } from './support/viewports';

const auctionId = process.env.EATBID_E2E_AUCTION_ID ?? '5796468';
const analysisUrl = `/auctions/${auctionId}/analysis`;
test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: 'active_theme', value: 'toss', domain: '127.0.0.1', path: '/' }
  ]);
});
test('새 상세는 비교조건으로 바로 시작하고 적용·탭·전체보기에서 같은 값을 유지한다', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000);
  const viewport = { width: VIEWPORT_WIDTH.designCanvas, height: 900 };
  await page.setViewportSize(viewport);
  await page.goto(analysisUrl);
  const form = page.getByRole('form', { name: '기관과 지역 비교조건' });
  await expect(form).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('창원 남산초등학교');
  await expect(page.getByRole('button', { name: '지역·전국과 비교' })).toHaveCount(0);
  await expect(form.getByRole('button', { name: '전 기간', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('새-상세-1440.png'), fullPage: true });
  await page.mouse.wheel(0, 500);
  await expect
    .poll(async () => (await page.locator('[data-slot="analysis-sticky"]').boundingBox())!.y)
    .toBe(56);
  await form.getByLabel('명단 최소').fill('24');
  await form.getByLabel('명단 최대').fill('12');
  await form.getByRole('button', { name: '조건 적용', exact: true }).click();
  await expect(form.getByText('최대 명단 수는 최소 이상이어야 해요.')).toBeVisible();
  await expect(form.getByLabel('명단 최대')).toBeFocused();
  expect(new URL(page.url()).searchParams.has('analysis')).toBe(false);
  await form.getByLabel('명단 최대').fill('');
  await form.getByLabel('비교 공고지역').selectOption('national');
  await form.getByRole('button', { name: '조건 적용', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has('analysis')).toBe(true);
  await expect(page.getByRole('heading', { name: '창원 남산초등학교 vs 전국 전체' })).toBeVisible();
  const applied = new URL(page.url()).searchParams.get('analysis')!;
  expect(JSON.parse(applied).listCountRange).toEqual({ min: 24, max: null });
  await page.getByRole('tab', { name: '시간별 추이' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '낙찰값 분포' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: '낙찰값 분포' })).toBeVisible();
  await page.getByRole('button', { name: '전체보기', exact: true }).click();
  await expect
    .poll(() => page.locator('[data-slot="analysis-screen"]').boundingBox())
    .toEqual({ x: 0, y: 0, ...viewport });
  await page.screenshot({ path: testInfo.outputPath('새-상세-전체보기.png') });
  expect(new URL(page.url()).searchParams.get('analysis')).toBe(applied);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="workspace-header"]')).toBeVisible();
  await expect(page.getByRole('button', { name: '전체보기', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByLabel('명단 최소')).toHaveValue('24');
  await expect(page.getByRole('tab', { name: '낙찰값 분포' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  expect(new URL(page.url()).searchParams.get('analysis')).toBe(applied);
});

test('새 상세의 휴대폰 조건 입력과 전체보기는 가로 화면을 넘지 않는다', async ({
  page
}, testInfo) => {
  test.setTimeout(90_000);
  const viewport = { width: VIEWPORT_WIDTH.phone, height: 812 };
  await page.setViewportSize(viewport);
  await page.goto(analysisUrl);
  const form = page.getByRole('form', { name: '기관과 지역 비교조건' });
  await form.getByRole('button', { name: '1개월', exact: true }).click();
  await form.getByLabel('날짜 기준').selectOption('announced');
  await form.getByRole('button', { name: '조건 적용', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    VIEWPORT_WIDTH.phone
  );
  await page.screenshot({ path: testInfo.outputPath('새-상세-375.png'), fullPage: true });
  await form.getByRole('button', { name: '조건 적용', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has('analysis')).toBe(true);
  expect(JSON.parse(new URL(page.url()).searchParams.get('analysis')!).dateBasis).toBe('announced');
  await page.getByRole('button', { name: '전체보기', exact: true }).click();
  await expect
    .poll(() => page.locator('[data-slot="analysis-screen"]').boundingBox())
    .toEqual({ x: 0, y: 0, ...viewport });
  await page.getByRole('button', { name: '전체보기 닫기' }).click();
  await expect(page.locator('[data-slot="workspace-header"]')).toBeVisible();
});

test('새 상세는 잘못된 주소 조건을 기존 차트나 0건 결과로 대체하지 않는다', async ({ page }) => {
  await page.goto(analysisUrl + '?analysis=%7Bbad');
  // Next가 hydration 뒤 붙이는 route announcer(`__next-route-announcer__`)도 role=alert라 페이지 전역
  // locator는 타이밍에 따라 둘로 풀린다(2026-09-15~16 main·PR 다섯 회차, EAT-228). 조건 오류는 폼 안의 것이다.
  const form = page.getByRole('form', { name: '기관과 지역 비교조건' });
  await expect(form.getByRole('alert')).toContainText('적용할 수 없는 비교조건');
  await expect(page.getByRole('heading', { name: '비교조건을 확인해 주세요' })).toBeVisible();
  await expect(page.getByRole('figure', { name: '회차별 낙찰률 흐름' })).toHaveCount(0);
  await expect(page.getByText('표본 0건')).toHaveCount(0);
});
