/** @module 책임: 분석 낙찰값 분포를 두 집단의 같은 사정률 구간 건수로 읽는 port와 application record를 소유한다. */
import type { AnalysisCohortQuery } from "./analysis-time-series-reader";
import type { MartBuildLineage } from "./mart-build-lineage";

/**
 * 구간 경계는 use case가 정한다. 어댑터가 집단마다 경계를 따로 잡으면 같은 막대 높이가 다른 구간을 말한다.
 * 첫 구간 아래는 `-1`, 마지막 구간 이상은 `binCount` 자리로 모아 센다.
 */
export interface AnalysisDistributionQuery extends AnalysisCohortQuery {
  readonly binFromMilli: bigint;
  readonly binWidthMilli: bigint;
  readonly binCount: number;
}

/** 한 집단의 구간별 건수다. 키는 구간 번호이며 `-1`은 아래 밖, `binCount`는 위 밖이다. */
export type AnalysisBinCounts = ReadonlyMap<number, number>;

export interface AnalysisDistributionReading {
  readonly lineage: MartBuildLineage | null;
  readonly target: AnalysisBinCounts;
  readonly comparison: AnalysisBinCounts;
}

export interface AnalysisDistributionReader {
  readDistribution(query: AnalysisDistributionQuery): Promise<AnalysisDistributionReading>;
}
