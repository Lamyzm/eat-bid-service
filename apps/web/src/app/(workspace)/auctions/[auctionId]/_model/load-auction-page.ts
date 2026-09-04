/** @module 책임: 공고 route의 ID 검증·조회·404 분기, 회차 이력 순차 조회(공고 응답의 organizationId가 있어야 조회할 수 있다)와 두 presentation의 조립 순서를 소유한다. */
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';
import type { OrganizationAuctionAttemptsV1Response } from '@eatbid/contracts/api/v1/organizations';

import type { DecisionSearch } from '../_lib/decision-search-params';
import { presentHistory, type HistoryPresentation } from './attempt-history';
import { presentDecision, type DecisionPresentation } from './present-decision';

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

export type DecisionPageData = {
  readonly decision: DecisionPresentation;
  readonly history: HistoryLoadResult;
};

type AuctionPageDependencies = {
  readonly parseAuctionId: (auctionId: string) => string;
  readonly getAuction: (input: { readonly auctionId: string }) => Promise<AuctionV1Response>;
  readonly isNotFound: (error: unknown) => boolean;
  readonly now: () => string;
  readonly listAttempts: (input: {
    readonly organizationId: string;
    readonly item?: string;
    readonly limit?: number;
  }) => Promise<OrganizationAuctionAttemptsV1Response>;
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
    return { state: 'ready', presentation: presentHistory(attempts, item) };
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
  const history = await loadHistory(response, search, dependencies);
  return { decision, history };
}
