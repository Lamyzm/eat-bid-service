import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { presentAuction, type AuctionPresentation } from './present-auction';

type AuctionPageDependencies = {
  readonly parseAuctionId: (auctionId: string) => string;
  readonly getAuction: (input: { readonly auctionId: string }) => Promise<AuctionV1Response>;
  readonly isNotFound: (error: unknown) => boolean;
};

/** route 제어 흐름을 순수하게 검증할 수 있도록 서버 I/O를 주입받는다. */
export async function loadAuctionPage(
  params: Promise<{ readonly auctionId: string }>,
  dependencies: AuctionPageDependencies
): Promise<AuctionPresentation | null> {
  const { auctionId: rawAuctionId } = await params;

  let auctionId: string;
  try {
    auctionId = dependencies.parseAuctionId(rawAuctionId);
  } catch {
    return null;
  }

  try {
    const response = await dependencies.getAuction({ auctionId });
    return presentAuction(response);
  } catch (error) {
    if (dependencies.isNotFound(error)) return null;
    throw error;
  }
}
