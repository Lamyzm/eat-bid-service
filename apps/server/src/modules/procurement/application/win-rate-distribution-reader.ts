/** @module 책임: 낙찰률 분포 조회 port와 mart 달×칸 행의 application record 형태를 소유한다. */
import type { MartCoverage } from "@eatbid/contracts";
import type { BidRate } from "@eatbid/domain";
import type { DistributionBinCount } from "./distribution-statistics";
import type { MartBuildLineage } from "./mart-build-lineage";
import type { DistributionCohort } from "../domain/distribution-cohort";
import type { KstMonth } from "../domain/kst-month";

/**
 * 조회 코호트다. 하한율은 사정률 축의 상수이므로 `BidRate`이고, 낙찰방식과 지역·기관은 숫자 id다.
 * 기간은 양끝을 포함한 KST 달 구간이며 use case가 이미 기본값을 채운 뒤의 값이다.
 */
export interface WinRateDistributionQuery {
  readonly cohort: DistributionCohort;
  readonly floorRate: BidRate;
  readonly awardMethodCodeValueId: bigint;
  readonly period: { readonly from: KstMonth; readonly to: KstMonth };
}

/** 한 달의 저장 폭 칸들이다. 요청 폭으로 다시 묶는 것은 조회가 아니라 application이 한다. */
export interface DistributionMonthRows {
  readonly month: KstMonth;
  readonly bins: readonly DistributionBinCount[];
}

export interface DistributionMonthCoverage {
  readonly month: KstMonth;
  readonly coverage: MartCoverage;
}

/**
 * 달×칸과 달별 보유율, 그리고 이 결과를 읽은 활성 build 하나를 함께 돌려준다.
 *
 * `storedBinWidthMilli`는 읽은 행들의 저장 폭이다. 행이 하나도 없으면 null이며 그때는 요청 폭을
 * 검증할 대상이 없다. 폭 목록을 계약에 박지 않고 실제 build의 폭으로 판정해야 build가 폭을 바꿀 때
 * 계약이 조용히 틀리지 않는다(설계 §3.2).
 */
export interface DistributionReading {
  readonly months: readonly DistributionMonthRows[];
  readonly coverage: readonly DistributionMonthCoverage[];
  readonly storedBinWidthMilli: bigint | null;
  readonly lineage: MartBuildLineage | null;
}

/**
 * 존재 확인과 분포 조회를 나눠야 "그 모집단이 없다"와 "그 모집단에 표본이 없다"를 use case가
 * 구분한다. 전국은 확인할 축이 없으므로 이 port를 부르지 않는다.
 */
export interface WinRateDistributionReader {
  cohortExists(cohort: DistributionCohort): Promise<boolean>;
  readDistribution(query: WinRateDistributionQuery): Promise<DistributionReading>;
}
