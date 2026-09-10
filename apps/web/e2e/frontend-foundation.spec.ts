/** @module 책임: 공고 route가 공통 셸(테마·사이드바·에러 경계)과 계약 응답 전환을 계약대로 지키는지 검사한다. 화면 전용 표시 규칙은 decision-screen.spec.ts가 맡는다. */
import { expect, test } from '@playwright/test';

import { VIEWPORT_WIDTH } from './support/viewports';

const SUCCESS_AUCTION_ID = '9007199254740993';
const FAILURE_AUCTION_ID = '9007199254740994';
const MISSING_AUCTION_ID = '9007199254740996';
const REDUCED_MOTION_AUCTION_ID = '9007199254741000';

test('공고 화면은 공통 셸과 화면 전용 skeleton 뒤 계약 응답을 표시한다', async ({ page }) => {
  await page.goto(`/auctions/${SUCCESS_AUCTION_ID}`, { waitUntil: 'commit' });
  await expect(page.getByRole('status', { name: '공고 정보를 불러오는 중' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '급식 식재료' })).toBeVisible();
  await expect(page.getByText('기초 1,234,567,890.50원')).toBeVisible();
  await expect(page.getByLabel('색상 테마')).toBeVisible();
  await expect(page.getByRole('button', { name: '명암 모드 전환' })).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
});

test('움직임 축소 환경에서는 loading skeleton 애니메이션을 실행하지 않는다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/auctions/${REDUCED_MOTION_AUCTION_ID}`, { waitUntil: 'commit' });

  const loading = page.getByRole('status', { name: '공고 정보를 불러오는 중' });
  await expect(loading).toBeVisible();
  const skeleton = loading.locator('[data-slot="skeleton"]').first();
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveCSS('animation-name', 'none');
});

test('유효하지 않거나 존재하지 않는 공고 ID는 같은 셸 안에서 찾을 수 없음으로 표시한다', async ({
  page
}) => {
  for (const auctionId of ['01', MISSING_AUCTION_ID]) {
    await page.goto(`/auctions/${auctionId}`);
    await expect(page.getByRole('heading', { name: '공고를 찾을 수 없습니다' })).toBeVisible();
    // 404 Problem이 `use cache` 경계를 예외로 넘으면 class 정체성을 잃어 error 경계로 샌다(EAT-97).
    await expect(page.getByRole('heading', { name: '공고 정보를 불러오지 못했습니다' })).toHaveCount(0);
    await expect(page.getByLabel('색상 테마')).toBeVisible();
  }
});

test('canonical 공고 화면의 header에는 legacy 지역 칩과 전역 설정 control이 없다', async ({ page }) => {
  await page.goto(`/auctions/${SUCCESS_AUCTION_ID}`);
  await expect(page.getByRole('heading', { name: '급식 식재료' })).toBeVisible();
  await expect(page.getByRole('button', { name: '명암 모드 전환' })).toBeVisible();
  await expect(page.getByLabel('보는 지역')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '전역 설정' })).toHaveCount(0);
  await expect(page.getByText(/^(계정|게스트)$/)).toHaveCount(0);
});

test('503은 404로 바꾸지 않고 안전한 재시도 경계에 전달한다', async ({ page }) => {
  await page.goto(`/auctions/${FAILURE_AUCTION_ID}`);

  await expect(
    page.getByRole('heading', { name: '공고 정보를 불러오지 못했습니다' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  await expect(page.getByText('의존성 내부 상세')).toHaveCount(0);
});

test('server 응답은 cookie theme을 반영하지 않고 첫 paint 전 inline script가 적용한다', async ({
  page,
  baseURL
}) => {
  await page.context().addCookies([{ name: 'active_theme', value: 'claude', url: baseURL! }]);

  const html = await (await page.request.get(`/auctions/${SUCCESS_AUCTION_ID}`)).text();
  expect(html).toContain('data-theme="eatbid"');
  expect(html).not.toContain('data-theme="claude"');

  await page.goto(`/auctions/${SUCCESS_AUCTION_ID}`, { waitUntil: 'commit' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude');
  await page.reload({ waitUntil: 'commit' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude');
  await expect(page.getByRole('heading', { name: '급식 식재료' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'claude');
});

test('접힌 sidebar cookie는 shell을 static으로 둔 채 client에서 반영된다', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'sidebar_state', value: 'false', url: baseURL! }]);

  await page.goto(`/auctions/${SUCCESS_AUCTION_ID}`);
  await expect(page.getByRole('heading', { name: '급식 식재료' })).toBeVisible();
  await expect(page.locator('[data-slot="sidebar"][data-state]').first()).toHaveAttribute(
    'data-state',
    'collapsed'
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-sidebar-state', 'collapsed');
});

test('hydration 전에도 inline script가 접힘 폭을 적용한다', async ({ browser, baseURL }) => {
  // script를 모두 막아 hydration을 없애면 남는 것은 HTML에 인라인된 script의 첫 paint 경로뿐이다.
  const context = await browser.newContext();
  await context.addCookies([{ name: 'sidebar_state', value: 'false', url: baseURL! }]);
  const page = await context.newPage();
  await page.route('**/*.js', (route) => route.abort());

  await page.goto(`/auctions/${SUCCESS_AUCTION_ID}`, { waitUntil: 'commit' });

  await expect(page.locator('html')).toHaveAttribute('data-sidebar-state', 'collapsed');
  const wrapper = page.locator('[data-slot="sidebar-wrapper"]').first();
  await expect(wrapper).toHaveCSS('--sidebar-width', '3rem');
  await context.close();
});

test('색상 테마 선택은 DOM과 cookie에 남아 새로고침 뒤에도 유지된다', async ({ page }) => {
  await page.goto(`/auctions/${SUCCESS_AUCTION_ID}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'eatbid');

  await page.getByLabel('색상 테마').click();
  await page.getByRole('option', { name: 'Vercel' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'vercel');

  await page.reload({ waitUntil: 'commit' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'vercel');
  await expect(page.getByRole('heading', { name: '급식 식재료' })).toBeVisible();
});

/**
 * 보조 패널·도구 줄의 고정/overlay 분기는 CSS(`@variant xl`)와 JS(useWideWorkspace)가 같은 경계를 읽는다.
 * 경계 양쪽 1px에서 봐야 둘 중 하나만 어긋나도 잡힌다(EAT-154).
 */
test('xl 경계에서 보조 패널은 경계 폭이면 본문 옆에 고정되고 1px 좁으면 Sheet로 열린다', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: VIEWPORT_WIDTH.xl, height: 900 });
  await page.goto(`/auctions/${SUCCESS_AUCTION_ID}`);
  await expect(page.getByRole('heading', { name: '급식 식재료' })).toBeVisible();

  const rail = page.locator('[data-slot="workspace-tool-rail"]');
  const headerTools = page.locator('[data-slot="workspace-header-tools"]');
  const persistentPanel = page.locator('section[data-slot="responsive-dock"]');
  await expect(rail).toBeVisible();
  await expect(headerTools).toBeHidden();

  await rail.getByRole('button', { name: '현재 공고 정보', exact: true }).click();
  await expect(persistentPanel).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // 고정 패널은 본문을 덮지 않고 본문 오른쪽 옆에 서며 viewport 안에 들어간다.
  const panelBox = (await persistentPanel.boundingBox())!;
  const pageBox = (await page.locator('[data-slot="workspace-page"]').boundingBox())!;
  expect(panelBox.x).toBeGreaterThanOrEqual(pageBox.x + pageBox.width);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(VIEWPORT_WIDTH.xl);

  // 같은 열림 상태에서 1px만 좁혀도 패널은 본문 옆 자리를 잃고 같은 내용이 Sheet로 열린다.
  await page.setViewportSize({ width: VIEWPORT_WIDTH.xl - 1, height: 900 });
  await expect(rail).toBeHidden();
  await expect(headerTools).toBeVisible();
  await expect(persistentPanel).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '현재 공고 정보' })).toBeVisible();
});
