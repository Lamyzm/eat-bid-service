/** @module 책임: 새 상세에 필요한 공고 한 건과 적용된 조건의 시간축·분포 자료, 운영자용 추천 투찰가를 읽고 기존 기관 이력·분포 조회와 분리한다. */
import type { AuctionBidPositionRead, AuctionRead } from '@/api/auctions/server';
import type { AnalysisDistributionRead, AnalysisTimeSeriesRead } from '@/api/analysis/server';
import { analysisTimeSeriesQueryOf } from '@/api/analysis';
import {
  presentAnalysisFilters,
  readAppliedAnalysis
} from '../_features/analysis-filters/model/present-analysis-filters';
import {
  presentTimeSeries,
  type TimeSeriesView
} from '../_features/time-series/model/present-time-series';
import { presentExclusionNote } from '../_features/time-series/model/present-exclusion-note';
import {
  presentDistribution,
  type DistributionView
} from '../_features/distribution/model/present-distribution';
import {
  presentBidPosition,
  type BidPositionView
} from '../_features/bid-position/model/present-bid-position';
import { presentAnalysisHeader } from './present-analysis-header';

type Dependencies = {
  readonly parseId: (value: string) => string;
  readonly readAuction: (input: { readonly auctionId: string }) => Promise<AuctionRead>;
  /**
   * query 입력 타입을 그대로 쓰지 않고 이 조회가 실제로 만드는 값(`analysisTimeSeriesQueryOf`의 결과)만
   * 받는다. 계약의 입력 타입에는 query string이 배열로도 값 하나로도 오는 자리가 `unknown`으로 열려
   * 있어, 그것을 의존성 경계에 그대로 두면 시험이 무엇을 넘겨야 하는지 타입이 말하지 못한다.
   */
  readonly readTimeSeries: (
    input: ReturnType<typeof analysisTimeSeriesQueryOf>
  ) => Promise<AnalysisTimeSeriesRead>;
  /** 분포는 시간축과 같은 query를 받는다. 두 그림이 같은 코호트를 말해야 한다. */
  readonly readDistribution: (
    input: ReturnType<typeof analysisTimeSeriesQueryOf>
  ) => Promise<AnalysisDistributionRead>;
  /** 운영자가 아니면 `forbidden`이 돌아오고 패널이 없다. 조건과 무관하게 공고 하나로 정해진다. */
  readonly readBidPosition: (input: {
    readonly auctionId: string;
  }) => Promise<AuctionBidPositionRead>;
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
  // 조건 기본값과 상태 칩이 서로 다른 순간을 보지 않게 시각은 한 번만 읽는다.
  const now = dependencies.now();
  const setup = presentAnalysisFilters(result.response, now);
  const applied = readAppliedAnalysis(rawFilter, setup);
  // 두 그림은 서로를 기다리지 않는다. 같은 조건을 동시에 묻고, 한쪽 실패는 그쪽 갈래로만 남는다.
  const [series, distribution, bidPosition] = await Promise.all([
    readTimeSeriesView(applied, dependencies),
    readDistributionView(applied, dependencies),
    readBidPositionView(auctionId, dependencies)
  ]);
  return {
    header: presentAnalysisHeader(result.response, now),
    setup,
    applied,
    timeSeries: series?.view ?? null,
    exclusionNote: series?.exclusionNote ?? null,
    distribution,
    bidPosition
  };
}

/**
 * 추천 투찰가는 곁가지 패널이다. 이 조회가 실패해도 분석 화면 전체를 error 경계로 보내지 않고 패널 안에서
 * "불러오지 못했다"고 말한다. 빈 패널로 바꾸지 않는 이유는 운영자가 "대상 아님"과 "실패"를 구분해야 해서다.
 */
async function readBidPositionView(
  auctionId: string,
  dependencies: Dependencies
): Promise<BidPositionView | null> {
  try {
    return presentBidPosition(await dependencies.readBidPosition({ auctionId }));
  } catch {
    return presentBidPosition({ kind: 'failed' });
  }
}

/**
 * 조건이 유효할 때만 조회한다. 무효한 조건으로 요청을 보내면 400 왕복이 화면의 정상 흐름이 되고,
 * 그때 화면이 보여야 할 것은 표본이 아니라 "조건을 고쳐 달라"는 말이다.
 */
async function readTimeSeriesView(
  applied: Awaited<ReturnType<typeof readAppliedAnalysis>>,
  dependencies: Dependencies
): Promise<{ readonly view: TimeSeriesView; readonly exclusionNote: string | null } | null> {
  if (applied.state !== 'pending') return null;
  const read = await dependencies.readTimeSeries(analysisTimeSeriesQueryOf(applied.filter));
  return {
    view: presentTimeSeries(read, applied.filter.floorRate.value),
    // 제외 문장은 그림이 아니라 자료 기준의 사실이라 시간축 표시 모델과 따로 둔다.
    exclusionNote: read.kind === 'series' ? presentExclusionNote(read.response) : null
  };
}

async function readDistributionView(
  applied: Awaited<ReturnType<typeof readAppliedAnalysis>>,
  dependencies: Dependencies
): Promise<DistributionView | null> {
  if (applied.state !== 'pending') return null;
  return presentDistribution(
    await dependencies.readDistribution(analysisTimeSeriesQueryOf(applied.filter))
  );
}
