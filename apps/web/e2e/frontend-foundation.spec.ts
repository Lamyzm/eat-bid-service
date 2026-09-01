import { expect, test } from '@playwright/test';

const SUCCESS_AUCTION_ID = '9007199254740993';
const FAILURE_AUCTION_ID = '9007199254740994';
const MISSING_AUCTION_ID = '9007199254740996';

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
  await page.goto(`/auctions/${SUCCESS_AUCTION_ID}`, { waitUntil: 'commit' });

  const skeleton = page.locator('[data-slot="skeleton"]').first();
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

test('503은 404로 바꾸지 않고 안전한 재시도 경계에 전달한다', async ({ page }) => {
  await page.goto(`/auctions/${FAILURE_AUCTION_ID}`);

  await expect(
    page.getByRole('heading', { name: '공고 정보를 불러오지 못했습니다' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  await expect(page.getByText('의존성 내부 상세')).toHaveCount(0);
});
