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
  // 조건은 누르는 버튼 없이 적용된다. 적어 넣는 칸은 칸을 떠날 때 보내고, 잘못된 범위는 조회하지
  // 않고 그 자리에서 설명한다.
  await form.getByLabel('명단 최대').fill('12');
  await form.getByLabel('명단 최소').fill('24');
  await form.getByLabel('명단 최소').blur();
  await expect(form.getByText('최대 명단 수는 최소 이상이어야 해요.')).toBeVisible();
  await form.getByLabel('명단 최대').fill('');
  await form.getByLabel('비교 공고지역').selectOption('national');
  await expect.poll(() => new URL(page.url()).searchParams.has('analysis')).toBe(true);
  await expect(page.getByRole('heading', { name: '창원 남산초등학교 vs 전국 전체' })).toBeVisible();
  expect(JSON.parse(new URL(page.url()).searchParams.get('analysis')!).listCountRange).toEqual({
    min: 24,
    max: null
  });
  await form.getByLabel('명단 최소').fill('');
  await form.getByLabel('명단 최소').blur();
  // 조회가 도는 동안 목록을 열면 팝업이 다시 그려지며 떨어져 나간다. 주소가 앉고 **응답이 화면에
  // 붙은 뒤**에 연다 — 주소는 낙관적으로 먼저 바뀌므로 주소만 기다리면 아직 도는 중이다.
  await expect
    .poll(() => JSON.parse(new URL(page.url()).searchParams.get('analysis')!).listCountRange)
    .toEqual({ min: null, max: null });
  await expect(page.getByText('비교조건을 적용하고 있어요.')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /5건.*9건/ })).toBeVisible();
  // 품목은 두 집단에 같게 걸린다(PDR-0007). 기관만 줄고 구름이 그대로면 조건 막대가 말하는 것과
  // 그린 것이 어긋난다. fixture의 `육류`는 기관 3건·비교군 4건이다.
  await form.getByRole('combobox', { name: '품목 전체' }).click();
  const beef = page.getByRole('option', { name: '육류', exact: true });
  await expect(beef).toBeVisible();
  await beef.click();
  await expect
    .poll(() => JSON.parse(new URL(page.url()).searchParams.get('analysis')!).itemFilter)
    .toEqual({ kind: 'atoms', atoms: ['육류'], unknown: false });
  await expect(page.getByRole('img', { name: /3건.*4건/ })).toBeVisible();
  // 여닫이는 고른 것을 폭이 변하지 않는 요약으로 말한다. 다시 눌러 해제하면 전체로 돌아간다.
  await page.keyboard.press('Escape');
  const itemTrigger = form.getByRole('combobox', { name: '품목 육류' });
  await expect(itemTrigger).toBeVisible();
  await expect(page.getByText('비교조건을 적용하고 있어요.')).toHaveCount(0);
  await itemTrigger.click();
  const beefAgain = page.getByRole('option', { name: '육류', exact: true });
  await expect(beefAgain).toBeVisible();
  await beefAgain.click();
  await expect
    .poll(() => JSON.parse(new URL(page.url()).searchParams.get('analysis')!).itemFilter)
    .toEqual({ kind: 'all' });
  await page.keyboard.press('Escape');
  const applied = new URL(page.url()).searchParams.get('analysis')!;
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
  await expect(page.getByLabel('비교 공고지역')).toHaveValue('national');
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    VIEWPORT_WIDTH.phone
  );
  await page.screenshot({ path: testInfo.outputPath('새-상세-375.png'), fullPage: true });
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
