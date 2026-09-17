/** @module 책임: 분석 시간축 조회 port와 기관 실제 점·비교군 밀도·달별 보유율의 application record를 소유한다. */
import type { MartCoverage } from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";
import type { KstMonth } from "../domain/kst-month";
import type { MartBuildLineage } from "./mart-build-lineage";

/** 비교 모집단이다. 지역 축은 mart의 지역 열이 병합된 뒤에 갈래로 붙는다(EAT-198). */
export type AnalysisComparisonScope = { readonly kind: "national" };

/**
 * 두 집단에 **똑같이** 적용되는 조건이다. 기관 쪽에만 걸리는 것은 `targetOrganizationId`와
 * `targetItemCodeValueId`뿐이며, 품목이 그런 이유는 비교군이 언제나 전체 품목이기 때문이다(PDR-0006).
 *
 * 기간은 양끝을 포함한 KST 달력일이 아니라 **반열림 instant 구간**이다. 달력일을 어디서 시각으로 바꿀지는
 * 한 곳에서만 정해야 하고 그 자리는 use case다 — 조회가 날짜를 다시 해석하면 같은 요청이 두 경계를 갖는다.
 * 시각으로 좁히면 `opened_at`에 함수를 씌우지 않으므로 분석 코호트 인덱스의 범위 스캔도 그대로 산다.
 *
 * `timeResolution`과 `rateBinWidthMilli`는 화면이 보낸 희망값이 아니라 **use case가 정해 내려보낸 눈금**이다.
 * 칸을 접는 일은 SQL이 하고(전국 5.7년이 23만 회차다) 무엇을 접을지는 application이 정한다.
 */
export interface AnalysisTimeSeriesQuery {
  readonly targetOrganizationId: bigint;
  /** 지금 보고 있는 회차다. 두 집단 모두에서 뺀다 — 자기 자신이 자기 분포를 만들면 안 된다. */
  readonly excludeAttemptId: bigint | null;
  readonly from: Temporal.Instant;
  readonly before: Temporal.Instant;
  /** `announced`면 위 구간과 X축을 개찰이 아니라 공고 시각에 건다. */
  readonly dateBasis: "opened" | "announced";
  readonly floorRateMilli: bigint;
  readonly awardMethodCodeValueId: bigint;
  /** 양끝 포함. null 경계는 그쪽 제한 없음이며 `0~0`은 전체와 다른 조건이다. */
  readonly listCountMin: number | null;
  readonly listCountMax: number | null;
  readonly targetItemCodeValueId: bigint | null;
  readonly comparisonScope: AnalysisComparisonScope;
  readonly timeResolution: "day" | "week" | "month";
  readonly rateBinWidthMilli: bigint;
  /** 이 수를 넘으면 기관 점을 자르고 잘렸다고 말한다. 자른 사실을 숨기고 그리지 않는다. */
  readonly targetPointLimit: number;
  /** 비교군이 이 수 이하일 때만 실제 점으로 온다. 넘으면 밀도다. */
  readonly comparisonPointLimit: number;
}

/** 실제 낙찰점 하나다. **회차 하나가 관측 하나**이며 명단 행 수만큼 복제하지 않는다(PDR-0006). */
export interface AnalysisPointRecord {
  readonly attemptId: bigint;
  readonly revisionId: bigint;
  readonly plottedAt: Temporal.Instant;
  readonly assessmentRateMilli: bigint;
}

/**
 * 비교군 밀도 칸 하나다. 시간 구간과 사정률 구간이 만나는 자리의 관측 수이며 두 축 모두 반개구간이다.
 * 왼쪽 끝만 싣는 이유는 폭이 요청 전체에서 상수이고, 폭을 칸마다 실으면 서로 다른 폭이 섞일 수 있는
 * 것처럼 읽히기 때문이다.
 */
export interface AnalysisDensityCellRecord {
  readonly fromAt: Temporal.Instant;
  readonly rateFromMilli: bigint;
  readonly count: number;
}

export type AnalysisComparisonSeriesRecord =
  | { readonly kind: "points"; readonly points: readonly AnalysisPointRecord[] }
  | { readonly kind: "density"; readonly cells: readonly AnalysisDensityCellRecord[] };

/** 요청 기간의 한 달이다. 두 집단의 분모가 다르므로 보유율도 집단마다 따로 판정한다(PDR-0003). */
export interface AnalysisMonthCoverage {
  readonly month: KstMonth;
  readonly target: MartCoverage;
  readonly comparison: MartCoverage;
}

/**
 * 한 번의 조회가 돌려주는 것 전부다. **두 집단을 한 읽기에서 낸다** — 따로 읽으면 같은 조건인데 서로
 * 다른 build를 볼 수 있고, 교집합 수는 두 집단을 동시에 봐야 셀 수 있다(PDR-0006).
 *
 * `targetTotal`·`comparisonTotal`은 상한에 걸리기 전의 전체 관측 수다. 화면이 "몇 개 중 몇 개를 그렸는지"를
 * 말하려면 잘린 뒤의 수가 아니라 이 수가 필요하다(AGENTS 3·7). 밀도 칸의 합이 `comparisonTotal`과 같아야
 * 하며, 다르면 표본을 뽑아 놓고 전체인 척한 것이다(EAT-216 acceptance 1).
 *
 * `overlapCount`는 두 집단에 함께 드는 관측 수다. 비교군에는 그 기관의 관측도 들어 있으므로 두 표본을
 * 단순히 더하면 그만큼 겹친다.
 */
export interface AnalysisTimeSeriesReading {
  readonly targetPoints: readonly AnalysisPointRecord[];
  readonly targetTotal: number;
  readonly comparison: AnalysisComparisonSeriesRecord;
  /** 밀도 칸이 상한에 걸려 기간 뒤쪽이 빠졌다는 사실이다. 이때만 칸 합이 전체 수보다 작다. */
  readonly comparisonTruncated: boolean;
  readonly comparisonTotal: number;
  readonly overlapCount: number;
  readonly coverage: readonly AnalysisMonthCoverage[];
  readonly lineage: MartBuildLineage | null;
  /**
   * 이 build가 읽은 봉인 입력의 기준 시각(`mart.build.as_of`)이다. 계보와 함께 오지만 공유 계보 record에
   * 넣지 않는 이유는, 스냅샷을 발급하는 조회가 이것 하나뿐인데 그 열을 공유 record에 더하면 mart를 읽는
   * 모든 어댑터와 그 테스트가 쓰지도 않는 값을 같이 들고 다니게 되기 때문이다. 계보가 null이면 이것도 null이다.
   */
  readonly sourceCutoffAt: Temporal.Instant | null;
}

/**
 * 기관의 존재 확인과 자료 읽기를 나눈다. "그 기관이 없다"와 "그 기관에 조건에 맞는 관측이 없다"는
 * 사용자가 할 일이 다르고, 앞은 404이며 뒤는 표본 0의 정상 응답이다(AGENTS 3, ADR 0011).
 */
export interface AnalysisTimeSeriesReader {
  organizationExists(organizationId: bigint): Promise<boolean>;
  readTimeSeries(query: AnalysisTimeSeriesQuery): Promise<AnalysisTimeSeriesReading>;
}
