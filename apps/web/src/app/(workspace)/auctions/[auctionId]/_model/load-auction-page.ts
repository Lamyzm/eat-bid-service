/** @module 책임: 공고 route의 ID 검증·조회·404 분기, 공고 응답이 있어야 만들 수 있는 회차 이력·분포의 병렬 조회와 세 presentation의 조립 순서를 소유한다. */
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';
import type { OrganizationAuctionAttemptsV1Response } from '@eatbid/contracts/api/v1/organizations';
import type {
  WinRateDistributionCohort,
  WinRateDistributionV1Response
} from '@/api/win-rate-distribution';

import type { DecisionSearch } from '../_lib/decision-search-params';
import { presentHistory, type HistoryPresentation } from './attempt-history';
import { cohortOf, periodOf } from './decision-cohort';
import { presentDecision, type DecisionPresentation } from './present-decision';
import { presentDistribution, type DistributionPresentation } from './present-distribution';

// query 계약의 item(positiveBigintTextSchema)과 같은 모양이다. URL에 남은 잘못된 값을 네트워크
// 호출 전에 걸러 무효 요청을 보내지 않는다.
const ITEM_ID_PATTERN = /^[1-9][0-9]{0,18}$/;

function normalizeItemParam(item: string | null): string | null {
  return item !== null && ITEM_ID_PATTERN.test(item) ? item : null;
}

/**
 * 과거 회차 모달이 cursor를 따라 더 부를 수 있는 페이지 상한. 첫 페이지 60행 × 10이면 계약 점 조회 상한
 * (≤ 200)과 같은 자릿수의 회차를 한 화면에 싣는 셈이라 그 위는 주소로 요청해도 잘라낸다.
 */
const MAX_HISTORY_PAGES = 10;
const HISTORY_PAGE_LIMIT = 60;

type HistoryLoadResult =
  | {
      readonly state: 'ready';
      /** 첫 페이지. 흐름 차트·표·"이 값이면"은 페이지를 더 불러도 이 표본을 그대로 쓴다. */
      readonly presentation: HistoryPresentation;
      /** 과거 회차 모달용. 요청한 페이지까지 이어 붙였고, 이어 부르다 실패하면 그 앞까지만 싣고 사실을 남긴다. */
      readonly expanded: { readonly presentation: HistoryPresentation; readonly loadFailed: boolean };
    }
  | { readonly state: 'no-organization' }
  | { readonly state: 'unavailable' };

/**
 * `locked`는 코호트를 만들 재료가 공고에 없다는 뜻이고 `unavailable`은 조회가 실패했다는 뜻이다.
 * 둘을 합치면 사용자가 할 일이 달라진다 — 앞은 수집이 더 필요하고 뒤는 다시 열어보면 될 수 있다.
 */
export type DistributionLoadResult =
  | {
      readonly state: 'ready';
      readonly presentation: DistributionPresentation;
      readonly response: WinRateDistributionV1Response;
    }
  | { readonly state: 'locked'; readonly reason: 'missing-terms' | 'missing-axis' }
  | { readonly state: 'unavailable' };

export type DecisionPageData = {
  readonly decision: DecisionPresentation;
  readonly history: HistoryLoadResult;
  readonly distribution: DistributionLoadResult;
};

type AuctionPageDependencies = {
  readonly parseAuctionId: (auctionId: string) => string;
  readonly getAuction: (input: { readonly auctionId: string }) => Promise<AuctionV1Response>;
  readonly isNotFound: (error: unknown) => boolean;
  readonly now: () => string;
  readonly listAttempts: (input: {
    readonly organizationId: string;
    readonly item?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }) => Promise<OrganizationAuctionAttemptsV1Response>;
  readonly findDistribution: (
    input: WinRateDistributionCohort
  ) => Promise<WinRateDistributionV1Response>;
};

// 주소의 페이지 수는 사용자가 손으로 고칠 수 있다. 정수 1 이상 상한 이하만 믿고 나머지는 1로 본다.
function normalizeHistoryPages(search: DecisionSearch): number {
  if (search.expand !== '과거 회차' || !Number.isInteger(search.pages) || search.pages < 1) return 1;
  return Math.min(search.pages, MAX_HISTORY_PAGES);
}

/**
 * 첫 페이지 뒤로 keyset cursor를 따라 페이지를 이어 붙인다. 이어진 응답을 하나의 계약 응답 모양으로 합쳐
 * `presentHistory`에 넣으므로 표시 규칙(자기 회차 제외·표본 수)은 한 곳에 남는다. 중간 페이지가 실패하면
 * (build 전환으로 cursor가 사라진 경우 포함) 거기서 멈추고 실패 사실을 함께 돌려준다.
 */
async function loadMorePages(
  first: OrganizationAuctionAttemptsV1Response,
  pageCount: number,
  input: { readonly organizationId: string; readonly item: string | undefined },
  dependencies: AuctionPageDependencies
): Promise<{ readonly merged: OrganizationAuctionAttemptsV1Response; readonly loadFailed: boolean }> {
  let merged = first;
  for (let page = 2; page <= pageCount && merged.nextCursor !== null; page += 1) {
    try {
      const next = await dependencies.listAttempts({ ...input, cursor: merged.nextCursor, limit: HISTORY_PAGE_LIMIT });
      merged = { ...merged, attempts: [...merged.attempts, ...next.attempts], nextCursor: next.nextCursor };
    } catch {
      return { merged, loadFailed: true };
    }
  }
  return { merged, loadFailed: false };
}

// 회차 이력은 공고 화면의 부차 evidence라 실패해도(404·400·기타) 화면 전체를 죽이지 않고
// 'unavailable'로만 담는다. 조직이 없는 공고(organization: null)는 애초에 조회하지 않는다.
async function loadHistory(
  response: AuctionV1Response,
  search: DecisionSearch,
  dependencies: AuctionPageDependencies
): Promise<HistoryLoadResult> {
  if (!response.organization) return { state: 'no-organization' };

  const item = normalizeItemParam(search.item);
  const input = { organizationId: response.organization.organizationId, item: item ?? undefined };
  try {
    const attempts = await dependencies.listAttempts({ ...input, limit: HISTORY_PAGE_LIMIT });
    const more = await loadMorePages(attempts, normalizeHistoryPages(search), input, dependencies);
    // 공고 ID는 회차(AuctionAttempt) ID와 같은 식별자라 응답 행과 그대로 견줄 수 있다.
    const options = { currentAttemptId: response.identity.auctionId };
    return {
      state: 'ready',
      presentation: presentHistory(attempts, item, options),
      expanded: { presentation: presentHistory(more.merged, item, options), loadFailed: more.loadFailed }
    };
  } catch {
    return { state: 'unavailable' };
  }
}

// 분포도 부차 evidence다. 실패가 화면 전체를 죽이지 않게 회차 이력과 같은 규약으로 담는다.
async function loadDistribution(
  response: AuctionV1Response,
  search: DecisionSearch,
  dependencies: AuctionPageDependencies
): Promise<DistributionLoadResult> {
  const lock = cohortOf(response, search, periodOf(search.period, dependencies.now()));
  if (lock.kind !== 'ready') return { state: 'locked', reason: lock.kind };
  const isRegionScope = search.scope === '도' || search.scope === '시군';
  try {
    // 비교집단 크게 보기는 같은 계약을 달별 칸까지 요청해 두 번째 endpoint 없이 히트맵을 그린다.
    const distribution = await dependencies.findDistribution({
      ...lock.cohort,
      granularity: search.expand === '비교집단' ? 'month' : 'total'
    });
    return {
      state: 'ready',
      presentation: presentDistribution(distribution, { myRate: search.myRate, isRegionScope }),
      response: distribution
    };
  } catch {
    return { state: 'unavailable' };
  }
}

/** route 제어 흐름을 순수하게 검증할 수 있도록 서버 I/O와 현재 시각을 주입받는다. */
export async function loadAuctionPage(
  params: Promise<{ readonly auctionId: string }>,
  search: DecisionSearch,
  dependencies: AuctionPageDependencies
): Promise<DecisionPageData | null> {
  const { auctionId: rawAuctionId } = await params;

  let auctionId: string;
  try {
    auctionId = dependencies.parseAuctionId(rawAuctionId);
  } catch {
    return null;
  }

  let response: AuctionV1Response;
  try {
    response = await dependencies.getAuction({ auctionId });
  } catch (error) {
    if (dependencies.isNotFound(error)) return null;
    throw error;
  }

  const decision = presentDecision(response, dependencies.now());
  // 회차 이력과 분포는 서로 의존하지 않으므로 공고 조회 뒤 한 번에 부른다. 순차로 부르면 첫 로드가
  // 두 왕복만큼 늦어진다.
  const [history, distribution] = await Promise.all([
    loadHistory(response, search, dependencies),
    loadDistribution(response, search, dependencies)
  ]);
  return { decision, history, distribution };
}
