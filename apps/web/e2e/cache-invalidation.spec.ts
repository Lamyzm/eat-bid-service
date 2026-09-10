/** @module 책임: 게이트 대상 읽기가 `use cache`를 버린 뒤 매 열람이 push 없이 활성 build를 그대로
 * 반영하는 것과, `/internal/cache/revalidate`의 인증·검증이 여전히 유효한 것을 프로덕션 build에서
 * 증명한다. dev 모드의 렌더 횟수는 배포와 다르므로 이 스위트는 `next build && next start`로만 돈다
 * (playwright.cache.config.ts).
 *
 * EAT-165 이전에는 `getAuctionFromServer`·`listOrganizationAuctionAttemptsFromServer`·
 * `findWinRateDistributionFromServer`가 `use cache`로 감싸여 있어 같은 build 재열람이 Nest를 다시
 * 부르지 않았고, 무효화 push가 있어야 새 계보를 읽었다. 게이트 대상 읽기가 `use cache`를 버리고
 * `privateServerRequest`로 세션 쿠키를 전달하도록 바뀐 뒤(ADR 0032 §14)로는 그 전제가 반대가
 * 됐다 — 매 열람이 실제로 Nest를 다시 부르므로 staleness 자체가 없고, 무효화 push는 더 이상
 * 이 세 읽기의 신선도에 필요하지 않다. 이 스위트는 그 반전을 고정한다. */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { CACHE_REVALIDATE_TOKEN, FIXTURE_ORIGIN } from '../playwright.cache.config';
import {
  ACTIVATE_BUILD_PATH,
  COUNTS_PATH,
  LINEAGE_PATH,
  RESET_PATH,
  type MartBackedRoute,
  type ObservedRoute
} from './support/cache-observability';

const AUCTION_ID = '5796468';
const FLOW_VIEW_URL = `/auctions/${AUCTION_ID}?view=${encodeURIComponent('흐름')}`;
// 열람이 끝났는지는 화면 문구가 아니라 자리로 기다린다. 흐름 캔버스는 회차 이력이 실제로 그려졌을 때만
// 있는 자리이며(`flow-chart.tsx`), 문구와 달리 시안이 바뀌어도 판정이 흔들리지 않는다.
const FLOW_CANVAS = '[data-slot="flow-canvas"]';
const BASE_BUILD_ID = 501;
const BASE_DISTRIBUTION_BUILD_ID = 601;
const REVALIDATE_URL = '/internal/cache/revalidate';

type Counts = Record<ObservedRoute, number>;
type Lineage = Record<MartBackedRoute, string | null>;

async function counts(request: APIRequestContext): Promise<Counts> {
  const response = await request.get(`${FIXTURE_ORIGIN}${COUNTS_PATH}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Counts;
}

/**
 * fixture가 마지막으로 내준 mart 계보다. 화면은 build id를 문구로 말하지 않기로 했으므로(apps/web
 * AGENTS: 화면 문구는 내부 사정을 설명하지 않는다) "어느 계보를 읽었는가"는 상류가 실제로 내준 값으로
 * 판정한다.
 */
async function lineage(request: APIRequestContext): Promise<Lineage> {
  const response = await request.get(`${FIXTURE_ORIGIN}${LINEAGE_PATH}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Lineage;
}

function servedLineage(offset: number): Lineage {
  return {
    organizationAttempts: String(BASE_BUILD_ID + offset),
    winRateDistribution: String(BASE_DISTRIBUTION_BUILD_ID + offset)
  };
}

async function waitForFlowView(page: Page): Promise<void> {
  await expect(page.locator(FLOW_CANVAS).first()).toBeVisible();
}

async function openFlowView(page: Page): Promise<void> {
  await page.goto(FLOW_VIEW_URL);
  await waitForFlowView(page);
}

async function reopenFlowView(page: Page): Promise<void> {
  await page.reload();
  await waitForFlowView(page);
}

test.describe('결정 화면 읽기와 무효화 endpoint', () => {
  test('재열람마다 Nest를 다시 불러 활성 build를 push 없이 그대로 읽는다', async ({ page, request }) => {
    test.setTimeout(120_000);
    expect((await request.get(`${FIXTURE_ORIGIN}${RESET_PATH}`)).status()).toBe(204);

    await openFlowView(page);
    const first = await counts(request);
    expect(first.auction).toBeGreaterThan(0);
    expect(first.organizationAttempts).toBeGreaterThan(0);
    expect(first.winRateDistribution).toBeGreaterThan(0);
    expect(await lineage(request)).toEqual(servedLineage(0));

    // 세 읽기 모두 `use cache`가 없으므로 재열람은 항상 Nest를 다시 부른다. 그 증가 자체가 이제는
    // 정상이다 — EAT-165 이전에는 여기서 요청 수가 그대로였어야 통과였다.
    await reopenFlowView(page);
    const second = await counts(request);
    expect(second.auction).toBeGreaterThan(first.auction);
    expect(second.organizationAttempts).toBeGreaterThan(first.organizationAttempts);
    expect(second.winRateDistribution).toBeGreaterThan(first.winRateDistribution);
    expect(await lineage(request)).toEqual(servedLineage(0));

    // push 없이 활성 build만 옮긴다. 캐시가 없으니 다음 열람 하나가 곧바로 새 계보를 읽는다 — 예전에는
    // 이 지점에서 push 없는 활성 전환이 화면에 반영되지 않는 것이 acceptance였다. 지금은 그 반대다.
    expect((await request.get(`${FIXTURE_ORIGIN}${ACTIVATE_BUILD_PATH}`)).status()).toBe(200);
    await reopenFlowView(page);
    expect(await lineage(request)).toEqual(servedLineage(1));
    const third = await counts(request);
    expect(third.organizationAttempts).toBeGreaterThan(second.organizationAttempts);
    expect(third.winRateDistribution).toBeGreaterThan(second.winRateDistribution);

    // dataplane push 계약 자체는 그대로다. 이 네 읽기에는 지울 캐시가 없지만(ADR 0032 §14) 유효한
    // 토큰의 호출은 여전히 204여야 다른 `use cache` 자원이 생겼을 때도 이 경로가 살아 있다.
    const revalidated = await request.post(REVALIDATE_URL, {
      headers: { authorization: `Bearer ${CACHE_REVALIDATE_TOKEN}` },
      data: { marts: ['org_round_summary', 'win_rate_distribution_monthly'], allAuctions: true }
    });
    expect(revalidated.status()).toBe(204);

    console.log(
      `[cache-e2e] first=${JSON.stringify(first)} second=${JSON.stringify(second)} afterActivate=${JSON.stringify(third)}`
    );
  });

  test('토큰이 없거나 틀린 무효화 요청은 401이다', async ({ request }) => {
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
