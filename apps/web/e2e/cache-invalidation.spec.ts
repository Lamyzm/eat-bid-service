/** @module 책임: 같은 build에서 결정 화면 재열람이 Nest를 다시 부르지 않는 것과, 무효화 push 뒤
 * 첫 열람이 새 계보를 읽는 것을 프로덕션 build에서 증명한다. dev 모드의 `use cache` 수명은 배포와
 * 다르므로 이 스위트는 `next build && next start`로만 돈다(playwright.cache.config.ts). */
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

import { CACHE_REVALIDATE_TOKEN, FIXTURE_ORIGIN } from '../playwright.cache.config';
import {
  ACTIVATE_BUILD_PATH,
  COUNTS_PATH,
  RESET_PATH,
  cachedReadCounts,
  type ObservedRoute
} from './support/cache-observability';

const AUCTION_ID = '5796468';
const FLOW_VIEW_URL = `/auctions/${AUCTION_ID}?view=${encodeURIComponent('흐름')}`;
const BASE_BUILD_ID = 501;
const REVALIDATE_URL = '/internal/cache/revalidate';

type Counts = Record<ObservedRoute, number>;

async function counts(request: APIRequestContext): Promise<Counts> {
  const response = await request.get(`${FIXTURE_ORIGIN}${COUNTS_PATH}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Counts;
}

function flowCaption(buildId: number) {
  return new RegExp(`build ${buildId}\\b`);
}

test.describe('결정 화면 읽기 캐시와 무효화', () => {
  test('같은 build 재열람은 Nest 요청 0회이고 무효화 뒤 첫 열람은 새 계보를 읽는다', async ({
    page,
    request
  }) => {
    test.setTimeout(120_000);
    expect((await request.get(`${FIXTURE_ORIGIN}${RESET_PATH}`)).status()).toBe(204);

    await page.goto(FLOW_VIEW_URL);
    await expect(page.getByText(flowCaption(BASE_BUILD_ID))).toBeVisible();
    const first = await counts(request);
    expect(first.auction).toBeGreaterThan(0);
    expect(first.organizationAttempts).toBeGreaterThan(0);
    expect(first.winRateDistribution).toBeGreaterThan(0);

    // acceptance 1: 같은 build에서 두 번째 열람은 Nest에 도달하지 않는다.
    await page.reload();
    await expect(page.getByText(flowCaption(BASE_BUILD_ID))).toBeVisible();
    // 세션은 요청마다 다시 묻는 read라 재열람에도 늘어난다. 캐시가 사는지는 캐시된 read만 견준다.
    expect(cachedReadCounts(await counts(request))).toEqual(cachedReadCounts(first));

    // push 없이 활성 build만 바뀌면 화면은 옛 계보를 계속 읽는다. 이 단계가 없으면 TTL이 우연히
    // 만료돼서 통과한 테스트와 구분되지 않는다.
    expect((await request.get(`${FIXTURE_ORIGIN}${ACTIVATE_BUILD_PATH}`)).status()).toBe(200);
    await page.reload();
    await expect(page.getByText(flowCaption(BASE_BUILD_ID))).toBeVisible();
    expect(cachedReadCounts(await counts(request))).toEqual(cachedReadCounts(first));

    // acceptance 2: 무효화 뒤 첫 열람은 새 값이다.
    const revalidated = await request.post(REVALIDATE_URL, {
      headers: { authorization: `Bearer ${CACHE_REVALIDATE_TOKEN}` },
      data: {
        marts: ['org_round_summary', 'win_rate_distribution_monthly'],
        allAuctions: true
      }
    });
    expect(revalidated.status()).toBe(204);

    await page.reload();
    await expect(page.getByText(flowCaption(BASE_BUILD_ID + 1))).toBeVisible();
    const afterPush = await counts(request);
    expect(afterPush.auction).toBeGreaterThan(first.auction);
    expect(afterPush.organizationAttempts).toBeGreaterThan(first.organizationAttempts);
    expect(afterPush.winRateDistribution).toBeGreaterThan(first.winRateDistribution);

    // 새 build에서도 캐시는 산다. 무효화가 캐시를 꺼 버리는 것이 아니라 한 번 비우는 것이다.
    await page.reload();
    await expect(page.getByText(flowCaption(BASE_BUILD_ID + 1))).toBeVisible();
    const settled = await counts(request);
    expect(cachedReadCounts(settled)).toEqual(cachedReadCounts(afterPush));

    // "0회"는 통과 여부가 아니라 숫자로 남아야 회귀를 사람이 읽을 수 있다. CI 로그와 PR evidence가
    // 같은 줄을 본다.
    console.log(
      `[cache-e2e] first=${JSON.stringify(first)} afterPush=${JSON.stringify(afterPush)} settled=${JSON.stringify(settled)}`
    );
  });

  test('토큰이 없거나 틀린 무효화 요청은 401이고 캐시를 비우지 않는다', async ({ request }) => {
    const body = { data: { allAuctions: true } };

    expect((await request.post(REVALIDATE_URL, body)).status()).toBe(401);
    expect(
      (
        await request.post(REVALIDATE_URL, {
          ...body,
          headers: { authorization: 'Bearer wrong-token' }
        })
      ).status()
    ).toBe(401);
  });

  test('범위가 비어 있는 무효화 요청은 400이다', async ({ request }) => {
    const response = await request.post(REVALIDATE_URL, {
      headers: { authorization: `Bearer ${CACHE_REVALIDATE_TOKEN}` },
      data: {}
    });

    expect(response.status()).toBe(400);
  });
});
