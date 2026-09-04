/** @module 책임: 공고 route의 ID 검증·조회·404 분기와 presentation 변환 순서를 소유한다. */
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { presentDecision, type DecisionPresentation } from './present-decision';

type AuctionPageDependencies = {
  readonly parseAuctionId: (auctionId: string) => string;
  readonly getAuction: (input: { readonly auctionId: string }) => Promise<AuctionV1Response>;
  readonly isNotFound: (error: unknown) => boolean;
  readonly now: () => string;
};

/** route 제어 흐름을 순수하게 검증할 수 있도록 서버 I/O와 현재 시각을 주입받는다. */
export async function loadAuctionPage(
  params: Promise<{ readonly auctionId: string }>,
  dependencies: AuctionPageDependencies
): Promise<DecisionPresentation | null> {
  const { auctionId: rawAuctionId } = await params;

  let auctionId: string;
  try {
    auctionId = dependencies.parseAuctionId(rawAuctionId);
  } catch {
    return null;
  }

  try {
    const response = await dependencies.getAuction({ auctionId });
    return presentDecision(response, dependencies.now());
  } catch (error) {
    if (dependencies.isNotFound(error)) return null;
    throw error;
  }
}
