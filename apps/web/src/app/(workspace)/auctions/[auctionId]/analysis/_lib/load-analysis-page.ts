/** @module 책임: 새 상세에 필요한 공고 한 건과 적용된 조건의 시간축 자료를 읽고 기존 기관 이력·분포 조회와 분리한다. */
import type { AuctionRead } from '@/api/auctions/server';
import type { AnalysisTimeSeriesRead } from '@/api/analysis/server';
import { analysisTimeSeriesQueryOf } from '@/api/analysis';
import {
  presentAnalysisFilters,
  readAppliedAnalysis
} from '../_features/analysis-filters/model/present-analysis-filters';
import {
  presentTimeSeries,
  type TimeSeriesView
} from '../_features/time-series/model/present-time-series';
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
  return {
    header: presentAnalysisHeader(result.response, now),
    setup,
    applied,
    timeSeries: await readTimeSeriesView(applied, dependencies)
  };
}

/**
 * 조건이 유효할 때만 조회한다. 무효한 조건으로 요청을 보내면 400 왕복이 화면의 정상 흐름이 되고,
 * 그때 화면이 보여야 할 것은 표본이 아니라 "조건을 고쳐 달라"는 말이다.
 */
async function readTimeSeriesView(
  applied: Awaited<ReturnType<typeof readAppliedAnalysis>>,
  dependencies: Dependencies
): Promise<TimeSeriesView | null> {
  if (applied.state !== 'pending') return null;
  return presentTimeSeries(
    await dependencies.readTimeSeries(analysisTimeSeriesQueryOf(applied.filter))
  );
}
