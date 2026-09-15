/** @module 책임: 새 상세에 필요한 공고 한 건을 읽고 공통 조건을 해석하며 기존 기관 이력·분포 조회와 분리한다. */
import type { AuctionRead } from '@/api/auctions/server';
import {
  presentAnalysisFilters,
  readAppliedAnalysis
} from '../_features/analysis-filters/model/present-analysis-filters';
import { presentAnalysisHeader } from './present-analysis-header';

type Dependencies = {
  readonly parseId: (value: string) => string;
  readonly readAuction: (input: { readonly auctionId: string }) => Promise<AuctionRead>;
  readonly now: () => string;
};
export async function loadAnalysisPage(
  rawId: string,
  rawFilter: string | null,
  dependencies: Dependencies
) {
  let auctionId: string;
  try {
    auctionId = dependencies.parseId(rawId);
  } catch {
    return null;
  }
  const result = await dependencies.readAuction({ auctionId });
  if (result.kind === 'not-found') return null;
  const setup = presentAnalysisFilters(result.response, dependencies.now());
  return {
    header: presentAnalysisHeader(result.response),
    setup,
    applied: readAppliedAnalysis(rawFilter, setup)
  };
}
