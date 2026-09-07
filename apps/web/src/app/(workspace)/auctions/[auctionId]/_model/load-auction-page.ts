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

type HistoryLoadResult =
  | { readonly state: 'ready'; readonly presentation: HistoryPresentation }
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

// 없는 공고는 예외가 아니라 결과다. 캐시된 server read가 예외의 class 정체성을 보존하지 못하므로
// 예상된 실패는 값으로 받는다(`api/auctions/server.ts`).
export type DecisionAuctionRead =
  | { readonly kind: 'auction'; readonly response: AuctionV1Response }
  | { readonly kind: 'not-found' };

type AuctionPageDependencies = {
  readonly parseAuctionId: (auctionId: string) => string;
  readonly getAuction: (input: { readonly auctionId: string }) => Promise<DecisionAuctionRead>;
  readonly now: () => string;
  readonly listAttempts: (input: {
    readonly organizationId: string;
    readonly item?: string;
    readonly limit?: number;
  }) => Promise<OrganizationAuctionAttemptsV1Response>;
  readonly findDistribution: (
    input: WinRateDistributionCohort
  ) => Promise<WinRateDistributionV1Response>;
};

// 회차 이력은 공고 화면의 부차 evidence라 실패해도(404·400·기타) 화면 전체를 죽이지 않고
// 'unavailable'로만 담는다. 조직이 없는 공고(organization: null)는 애초에 조회하지 않는다.
async function loadHistory(
  response: AuctionV1Response,
  search: DecisionSearch,
  dependencies: AuctionPageDependencies
): Promise<HistoryLoadResult> {
  if (!response.organization) return { state: 'no-organization' };

  const item = normalizeItemParam(search.item);
  try {
    const attempts = await dependencies.listAttempts({
      organizationId: response.organization.organizationId,
      item: item ?? undefined,
      limit: 60
    });
    // 공고 ID는 회차(AuctionAttempt) ID와 같은 식별자라 응답 행과 그대로 견줄 수 있다.
    return {
      state: 'ready',
      presentation: presentHistory(attempts, item, { currentAttemptId: response.identity.auctionId })
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
    // 크게 보기는 같은 계약을 달별 칸까지 요청해 두 번째 endpoint 없이 히트맵을 그린다.
    const distribution = await dependencies.findDistribution({
      ...lock.cohort,
      granularity: search.expand ? 'month' : 'total'
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

  // 없음은 값으로 오고 그 밖의 실패는 그대로 올라가 route error 경계가 받는다.
  const read = await dependencies.getAuction({ auctionId });
  if (read.kind === 'not-found') return null;
  const { response } = read;

  const decision = presentDecision(response, dependencies.now());
  // 회차 이력과 분포는 서로 의존하지 않으므로 공고 조회 뒤 한 번에 부른다. 순차로 부르면 첫 로드가
  // 두 왕복만큼 늦어진다.
  const [history, distribution] = await Promise.all([
    loadHistory(response, search, dependencies),
    loadDistribution(response, search, dependencies)
  ]);
  return { decision, history, distribution };
}
