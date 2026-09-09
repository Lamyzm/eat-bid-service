/**
 * @module 책임: 로그인하지 않은 브라우저가 업무 화면에 닿지 못하고 보던 경로와 함께 로그인 화면으로
 * 가는지, 초기화가 끝나지 않은 계정이 설정 화면으로 가는지, 로그인 화면 자체는 그대로 열리는지 검사한다.
 */
import { expect, test } from '@playwright/test';

import { SESSION_COOKIE_NAME, UNINITIALIZED_SESSION_COOKIE_VALUE } from './support/session-fixture';

const AUCTION_ID = '9007199254740993';

// 이 스위트만 로그인 상태를 비운다. 나머지 스위트는 config의 storageState로 로그인해 있다.
test.use({ storageState: { cookies: [], origins: [] } });

test('미로그인 브라우저는 오늘 화면 대신 로그인 화면을 본다', async ({ page }) => {
  await page.goto('/today');
  await expect(page).toHaveURL(/\/login\?next=%2Ftoday$/);
  await expect(page.getByRole('button', { name: 'Google로 로그인' })).toBeVisible();
});

test('미로그인 브라우저는 공고 상세 대신 로그인 화면을 보고 보던 공고를 잃지 않는다', async ({
  page
}) => {
  await page.goto(`/auctions/${AUCTION_ID}`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fauctions%2F${AUCTION_ID}$`));
  // 공고 화면의 어떤 내용도 렌더되지 않아야 한다. 데이터가 보인 뒤 이동하면 게이트가 아니다.
  await expect(page.getByRole('heading', { name: '급식 식재료' })).toHaveCount(0);
});

test('루트 진입도 로그인 화면으로 가고 로그인 화면은 세션 없이 열린다', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?next=/);

  const direct = await page.goto('/login');
  expect(direct?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
});

test('세션은 있지만 초기화가 끝나지 않은 계정은 설정 화면으로 가고 보던 공고를 잃지 않는다', async ({
  page,
  context,
  baseURL
}) => {
  // 쿠키만 보는 proxy는 이 요청을 통과시킨다. 걸러야 하는 것은 세션 계약을 읽는 layout이다.
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: UNINITIALIZED_SESSION_COOKIE_VALUE, url: baseURL! }
  ]);
  await page.goto(`/auctions/${AUCTION_ID}`);
  await expect(page).toHaveURL(new RegExp(`/setup\\?next=%2Fauctions%2F${AUCTION_ID}$`));
});

test('화면 응답은 검색 색인을 거부한다', async ({ page }) => {
  const response = await page.goto('/login');
  expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
});
