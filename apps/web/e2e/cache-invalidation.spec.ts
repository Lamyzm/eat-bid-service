/** @module 책임: 게이트 대상 읽기가 `use cache`를 버린 뒤 매 열람이 push 없이 활성 build를 그대로
 * 반영하는 것과, `/internal/cache/revalidate`의 인증·검증이 여전히 유효한 것을 프로덕션 build에서
 * 증명한다. dev 모드의 렌더 횟수는 배포와 다르므로 이 스위트는 `next build && next start`로만 돈다
 * (playwright.cache.config.ts).
 *
 * EAT-165 이전에는 상세의 읽기가 `use cache`로 감싸여 있어 같은 build 재열람이 Nest를 다시 부르지 않았고,
 * 무효화 push가 있어야 새 계보를 읽었다. 게이트 대상 읽기가 `use cache`를 버리고 `privateServerRequest`로
 * 세션 쿠키를 전달하도록 바뀐 뒤(ADR 0032 §14)로는 그 전제가 반대가 됐다 — 매 열람이 실제로 Nest를 다시
 * 부르므로 staleness 자체가 없다. 공고 상세가 새 분석 화면으로 바뀐 뒤(EAT-224)에는 그 화면의 공고·추이·
 * 분포 읽기가 같은 성질을 지키는지 본다. */
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
const DETAIL_URL = `/auctions/${AUCTION_ID}`;
// 열람이 끝났는지는 화면 문구가 아니라 자리로 기다린다. 추이 canvas는 서버가 읽은 시간축이 실제로
// 그려졌을 때만 있는 자리라, 문구와 달리 시안이 바뀌어도 판정이 흔들리지 않는다.
const TIME_SERIES_CANVAS = '[data-slot="analysis-evidence"] canvas';
const BASE_ANALYSIS_BUILD_ID = 701;
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

/** 새 상세가 읽는 두 분석 조회의 계보다. 옛 상세 조회는 이 화면이 부르지 않으므로 보지 않는다. */
function analysisLineage(lineageValue: Lineage): Pick<Lineage, 'analysisTimeSeries' | 'analysisDistribution'> {
  return {
    analysisTimeSeries: lineageValue.analysisTimeSeries,
    analysisDistribution: lineageValue.analysisDistribution
  };
}

function servedLineage(offset: number): Pick<Lineage, 'analysisTimeSeries' | 'analysisDistribution'> {
  return {
    analysisTimeSeries: String(BASE_ANALYSIS_BUILD_ID + offset),
    analysisDistribution: String(BASE_ANALYSIS_BUILD_ID + offset)
  };
}

async function waitForDetail(page: Page): Promise<void> {
  await expect(page.locator(TIME_SERIES_CANVAS).first()).toBeVisible();
}

async function openDetail(page: Page): Promise<void> {
  await page.goto(DETAIL_URL);
  await waitForDetail(page);
}

async function reopenDetail(page: Page): Promise<void> {
  await page.reload();
  await waitForDetail(page);
}

test.describe('결정 화면 읽기와 무효화 endpoint', () => {
  test('재열람마다 Nest를 다시 불러 활성 build를 push 없이 그대로 읽는다', async ({ page, request }) => {
    test.setTimeout(120_000);
    expect((await request.get(`${FIXTURE_ORIGIN}${RESET_PATH}`)).status()).toBe(204);

    await openDetail(page);
    const first = await counts(request);
    expect(first.auction).toBeGreaterThan(0);
    expect(first.analysisTimeSeries).toBeGreaterThan(0);
    expect(first.analysisDistribution).toBeGreaterThan(0);
    expect(analysisLineage(await lineage(request))).toEqual(servedLineage(0));

    // 세 읽기 모두 `use cache`가 없으므로 재열람은 항상 Nest를 다시 부른다. 그 증가 자체가 정상이다.
    await reopenDetail(page);
    const second = await counts(request);
    expect(second.auction).toBeGreaterThan(first.auction);
    expect(second.analysisTimeSeries).toBeGreaterThan(first.analysisTimeSeries);
    expect(second.analysisDistribution).toBeGreaterThan(first.analysisDistribution);
    expect(analysisLineage(await lineage(request))).toEqual(servedLineage(0));

    // push 없이 활성 build만 옮긴다. 캐시가 없으니 다음 열람 하나가 곧바로 새 계보를 읽는다.
    expect((await request.get(`${FIXTURE_ORIGIN}${ACTIVATE_BUILD_PATH}`)).status()).toBe(200);
    await reopenDetail(page);
    expect(analysisLineage(await lineage(request))).toEqual(servedLineage(1));
    const third = await counts(request);
    expect(third.analysisTimeSeries).toBeGreaterThan(second.analysisTimeSeries);
    expect(third.analysisDistribution).toBeGreaterThan(second.analysisDistribution);

    // dataplane push 계약 자체는 그대로다. 이 읽기들에는 지울 캐시가 없지만(ADR 0032 §14) 유효한
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
