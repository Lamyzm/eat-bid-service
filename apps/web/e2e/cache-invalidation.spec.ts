/** @module 책임: 같은 build에서 결정 화면 재열람이 Nest를 다시 부르지 않는 것과, 무효화 push 뒤
 * 첫 열람이 새 계보를 읽는 것을 프로덕션 build에서 증명한다. dev 모드의 `use cache` 수명은 배포와
 * 다르므로 이 스위트는 `next build && next start`로만 돈다(playwright.cache.config.ts). */
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { CACHE_REVALIDATE_TOKEN, FIXTURE_ORIGIN } from '../playwright.cache.config';
import {
  ACTIVATE_BUILD_PATH,
  COUNTS_PATH,
  LINEAGE_PATH,
  RESET_PATH,
  cachedReadCounts,
  type MartBackedRoute,
  type ObservedRoute
} from './support/cache-observability';

const AUCTION_ID = '5796468';
const FLOW_VIEW_URL = `/auctions/${AUCTION_ID}?view=${encodeURIComponent('흐름')}`;
// 열람이 끝났는지는 화면 문구가 아니라 자리로 기다린다. 흐름 캔버스는 회차 이력이 실제로 그려졌을 때만
// 있는 자리이며(`flow-chart.tsx`), 문구와 달리 시안이 바뀌어도 캐시 판정이 흔들리지 않는다.
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
 * 판정한다. 요청이 없었으면 이 값은 그대로 남아 "캐시가 답했다"를 같은 자리에서 말한다.
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

/**
 * 열람 한 번이 끝날 때까지 기다린다. 캔버스가 보인다는 것은 이 응답을 만든 서버 렌더가 회차 이력을
 * 실제로 그렸다는 뜻이고, 분포는 같은 렌더가 함께 읽는다(evidence-tabs.tsx). 그래서 뒤이어 읽는 요청
 * 수와 계보는 지금 보이는 화면을 만든 그 렌더의 결과다.
 *
 * streaming 중에는 같은 자리가 React의 숨은 전달 컨테이너에도 잠깐 존재해 선택자가 두 개를 집는다.
 * 문서 순서로 앞선 한 벌만 보고 그것이 보일 때까지 기다리면 그 순간을 strict mode 위반 없이 지난다.
 */
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

test.describe('결정 화면 읽기 캐시와 무효화', () => {
  test('같은 build 재열람은 Nest 요청 0회이고 무효화 뒤 첫 열람은 새 계보를 읽는다', async ({
    page,
    request
  }) => {
    test.setTimeout(120_000);
    expect((await request.get(`${FIXTURE_ORIGIN}${RESET_PATH}`)).status()).toBe(204);

    await openFlowView(page);
    const first = await counts(request);
    expect(first.auction).toBeGreaterThan(0);
    expect(first.organizationAttempts).toBeGreaterThan(0);
    expect(first.winRateDistribution).toBeGreaterThan(0);
    expect(await lineage(request)).toEqual(servedLineage(0));

    // acceptance 1: 같은 build에서 두 번째 열람은 Nest에 도달하지 않는다.
    await reopenFlowView(page);
    // 세션은 요청마다 다시 묻는 read라 재열람에도 늘어난다. 캐시가 사는지는 캐시된 read만 견준다.
    expect(cachedReadCounts(await counts(request))).toEqual(cachedReadCounts(first));

    // push 없이 활성 build만 바뀌면 화면은 옛 계보를 계속 읽는다. 이 단계가 없으면 TTL이 우연히
    // 만료돼서 통과한 테스트와 구분되지 않는다.
    expect((await request.get(`${FIXTURE_ORIGIN}${ACTIVATE_BUILD_PATH}`)).status()).toBe(200);
    await reopenFlowView(page);
    expect(cachedReadCounts(await counts(request))).toEqual(cachedReadCounts(first));
    // 새 계보를 내준 적이 없다 = 지금 보이는 화면은 여전히 첫 열람이 읽은 build다.
    expect(await lineage(request)).toEqual(servedLineage(0));

    // acceptance 2: 무효화 뒤 첫 열람은 새 값이다.
    const revalidated = await request.post(REVALIDATE_URL, {
      headers: { authorization: `Bearer ${CACHE_REVALIDATE_TOKEN}` },
      data: {
        marts: ['org_round_summary', 'win_rate_distribution_monthly'],
        allAuctions: true
      }
    });
    expect(revalidated.status()).toBe(204);

    await reopenFlowView(page);
    const afterPush = await counts(request);
    expect(afterPush.auction).toBeGreaterThan(first.auction);
    expect(afterPush.organizationAttempts).toBeGreaterThan(first.organizationAttempts);
    expect(afterPush.winRateDistribution).toBeGreaterThan(first.winRateDistribution);
    // 그 요청이 받아 간 계보다. 요청 수만 보면 "다시 물었다"까지고, 이 줄이 있어야 "새 계보로 그렸다"가 된다.
    expect(await lineage(request)).toEqual(servedLineage(1));

    // 새 build에서도 캐시는 산다. 무효화가 캐시를 꺼 버리는 것이 아니라 한 번 비우는 것이다.
    await reopenFlowView(page);
    const settled = await counts(request);
    expect(cachedReadCounts(settled)).toEqual(cachedReadCounts(afterPush));
    expect(await lineage(request)).toEqual(servedLineage(1));

    // "0회"는 통과 여부가 아니라 숫자로 남아야 회귀를 사람이 읽을 수 있다. CI 로그와 PR evidence가
    // 같은 줄을 본다.
    console.log(
      `[cache-e2e] first=${JSON.stringify(first)} afterPush=${JSON.stringify(afterPush)} settled=${JSON.stringify(settled)}`
    );
  });

  test('토큰이 없거나 틀린 무효화 요청은 401이고 캐시를 비우지 않는다', async ({ page, request }) => {
    test.setTimeout(60_000);
    const body = { data: { allAuctions: true } };
    // 이 검사가 스스로 캐시를 채운다. 앞 테스트가 남긴 상태에 기대면 단독 실행에서 판정이 달라진다.
    await openFlowView(page);
    const before = await counts(request);

    expect((await request.post(REVALIDATE_URL, body)).status()).toBe(401);
    expect(
      (
        await request.post(REVALIDATE_URL, {
          ...body,
          headers: { authorization: 'Bearer wrong-token' }
        })
      ).status()
    ).toBe(401);

    // 거절된 요청이 캐시를 비웠다면 이 열람이 Nest를 다시 부른다. 제목이 말하는 "비우지 않는다"를
    // 401 status가 아니라 상류 접근 횟수로 판정한다.
    await reopenFlowView(page);
    expect(cachedReadCounts(await counts(request))).toEqual(cachedReadCounts(before));
  });

  test('범위가 비어 있는 무효화 요청은 400이다', async ({ request }) => {
    const response = await request.post(REVALIDATE_URL, {
      headers: { authorization: `Bearer ${CACHE_REVALIDATE_TOKEN}` },
      data: {}
    });

    expect(response.status()).toBe(400);
  });
});
