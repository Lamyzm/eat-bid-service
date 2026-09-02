import { expect, test } from '@playwright/test';

const SUCCESS_AUCTION_ID = '9007199254740993';
const FAILURE_AUCTION_ID = '9007199254740994';
const MISSING_AUCTION_ID = '9007199254740996';
const REDUCED_MOTION_AUCTION_ID = '9007199254741000';

test('공고 화면은 공통 셸과 화면 전용 skeleton 뒤 계약 응답을 표시한다', async ({ page }) => {
  await page.goto(`/auctions/${SUCCESS_AUCTION_ID}`, { waitUntil: 'commit' });
  await expect(page.getByRole('status', { name: '공고 정보를 불러오는 중' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '급식 식재료' })).toBeVisible();
  await expect(page.getByText('1,234,567,890.50 KRW')).toBeVisible();
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

test('legacy dashboard는 slot으로 주입된 전역 설정 control과 계정 허브와 본문을 그대로 보여 준다', async ({ page }) => {
  await page.goto('/dashboard/today', { waitUntil: 'commit' });
  await expect(page.getByRole('button', { name: '전역 설정' })).toBeVisible();
  await expect(page.getByRole('button', { name: '명암 모드 전환' })).toBeVisible();
  await expect(page.getByText(/^(계정|게스트)$/).first()).toBeVisible();
  await expect(page.getByRole('status', { name: '대시보드를 불러오는 중' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '오늘', level: 1 })).toBeVisible();
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
