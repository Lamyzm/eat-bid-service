/**
 * @module 책임: 분석 시간축 조회의 눈금 정책·달력 경계 번역·달별 보유율 접기와 스냅샷 발급을 소유한다.
 *
 * 조회는 "무엇을 세는가"를 알고 이 use case는 "어떤 눈금으로 셀 것인가"를 정한다. 눈금을 조회가 정하면
 * 같은 질문이 어댑터마다 다른 칸을 내고, 화면이 정하면 창 크기가 코호트를 바꾼다(EAT-216 범위).
 */
import type { MartCoverage } from "@eatbid/contracts";
import type { BidRate, Clock, Temporal } from "@eatbid/domain";
import { Effect } from "effect";
import { rateTextMilli } from "./distribution-statistics";
import { ProcurementDependencyUnavailable } from "./failures";
import { OrganizationNotFound } from "./list-organization-auction-attempts";
import type { MartBuildLineage } from "./mart-build-lineage";
import type {
  AnalysisComparisonScope,
  AnalysisComparisonSeriesRecord,
  AnalysisMonthCoverage,
  AnalysisPointRecord,
  AnalysisTimeSeriesReader,
  AnalysisTimeSeriesReading,
} from "./analysis-time-series-reader";
import { kstDate, kstDayAfter, kstDayStart, type KstDate } from "../domain/kst-day";
import {
  kstMonthFirstDayText,
  kstMonthLastDayText,
  kstMonthOf,
  kstMonthsBetween,
  type KstMonth,
} from "../domain/kst-month";
import type { OrganizationId } from "../domain/organization-id";

/**
 * 시간 눈금의 경계다. 하루 눈금을 넓은 기간까지 끌고 가면 칸 수가 기간에 비례해 늘고, 달 눈금을 좁은
 * 기간에 쓰면 두세 칸짜리 그림이 된다. 4개월과 2년은 화면의 기간 칩(1·3·6개월·1·3·5년)이 어느 쪽으로도
 * 한 눈금 안에 들어오게 고른 값이다.
 */
const DAY_RESOLUTION_MAX_DAYS = 120;
const WEEK_RESOLUTION_MAX_DAYS = 800;

/**
 * 사정률 칸의 폭이다. 0.1%p인 이유는 이 축에서 사람이 구별해서 판단하는 최소 단위가 그 자리이기
 * 때문이다. 더 잘게 쪼개면 칸 대부분이 1건짜리라 밀도가 아니라 점이 되고, 1%p로 넓히면 낙찰선 근처의
 * 모양이 한 칸에 뭉개진다. 실제로 적용한 폭은 응답의 축이 말하므로 화면이 이 상수를 다시 알 필요는 없다.
 */
const RATE_BIN_WIDTH_MILLI = 100n;

/** 기관 점 상한이다. EAT-216이 초기 가설로 적은 5천을 그대로 쓰고 넘으면 잘렸다고 말한다. */
const TARGET_POINT_LIMIT = 5_000;

/**
 * 비교군이 이 수 이하일 때만 실제 점으로 온다. 2천인 이유는 점을 눌러 그 회차로 건너가는 것이 좁은
 * 범위에서만 뜻이 있기 때문이다. 넓은 범위에서 점 수천 개를 보내면 겹쳐서 어느 점을 눌렀는지 알 수 없고,
 * 그 상태의 답은 점이 아니라 밀도다.
 */
const COMPARISON_POINT_LIMIT = 2_000;

/** 스냅샷의 유효 기간이다. 하루인 이유는 수집이 하루 주기라 그보다 오래 고정하면 새 관측을 못 본다. */
const SNAPSHOT_TTL_HOURS = 24;

/** 관측의 정의에 붙인 판이다. "낙찰 판정 행의 사정률을 회차당 하나 센다"가 바뀌면 이 값이 바뀐다. */
export const OBSERVATION_POLICY_VERSION = "awarded-attempt-v1";

/**
 * 비교 지역의 코드값이 그 체계 안에 없다는 사실이다. 표본 0의 빈 결과로 뭉개지 않는 이유는 사용자가
 * 할 일이 다르기 때문이다 — 없는 지역은 조건을 고쳐야 하고, 표본 0은 기간이나 조건을 넓혀야 한다.
 */
export class AnalysisRegionNotFound extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor(readonly scheme: string, readonly codeValueId: bigint) {
    super(`Region code value ${codeValueId.toString(10)} was not found in ${scheme}`);
    this.name = "AnalysisRegionNotFound";
  }
}

export interface AnalysisPeriodInput {
  readonly from: KstDate;
  readonly to: KstDate;
}

export interface FindAnalysisTimeSeriesInput {
  readonly targetOrganizationId: OrganizationId;
  readonly excludeAttemptId: bigint | null;
  readonly period: AnalysisPeriodInput;
  readonly dateBasis: "opened" | "announced";
  readonly comparisonScope: AnalysisComparisonScope;
  readonly floorRate: BidRate;
  readonly awardMethodCodeValueId: bigint;
  readonly listCountMin: number | null;
  readonly listCountMax: number | null;
  readonly targetItemCodeValueId: bigint | null;
}

/** 서버가 실제로 적용한 눈금이다. 요청이 준 희망값이 아니라 상한까지 반영한 결과다. */
export interface AnalysisAxisResult {
  readonly timeResolution: "day" | "week" | "month";
  /** 비교군이 점으로 오면 칸이 없으므로 null이다. */
  readonly rateBinWidthMilli: bigint | null;
}

/**
 * 발급한 스냅샷이다. `sourceCutoffAt`은 build가 읽은 봉인 입력의 기준 시각이고 `issuedAt`은 이 답을
 * 만든 시각이라 둘은 다르다. 앞을 뒤로 대신하면 "언제까지의 자료인가"가 "언제 물었는가"로 바뀐다.
 */
export interface AnalysisSnapshotResult {
  readonly sourceCutoffAt: Temporal.Instant;
  readonly issuedAt: Temporal.Instant;
  readonly expiresAt: Temporal.Instant;
  readonly observationPolicyVersion: string;
  readonly lineage: MartBuildLineage;
}

/**
 * 준비된 결과다. 활성 build가 없으면 이 형태가 아니라 `unavailable`이며, 표본 수를 0으로 채우지 않는다
 * — 관측된 0건과 미발행은 사용자가 할 일이 다르다(AGENTS 3).
 */
export interface AnalysisTimeSeriesReady {
  readonly state: "ready";
  readonly input: FindAnalysisTimeSeriesInput;
  readonly axis: AnalysisAxisResult;
  readonly snapshot: AnalysisSnapshotResult;
  readonly targetPoints: readonly AnalysisPointRecord[];
  readonly targetTotal: number;
  readonly targetTruncated: boolean;
  readonly comparison: AnalysisComparisonSeriesRecord;
  readonly comparisonTruncated: boolean;
  readonly comparisonTotal: number;
  readonly overlapCount: number;
  readonly coverage: readonly AnalysisCoverageSegment[];
}

export interface AnalysisTimeSeriesUnavailable {
  readonly state: "unavailable";
  readonly input: FindAnalysisTimeSeriesInput;
  readonly reason: "snapshot-unavailable";
}

export type AnalysisTimeSeriesResult = AnalysisTimeSeriesReady | AnalysisTimeSeriesUnavailable;

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * 양끝을 포함한 달력일 수다. 시각 차를 하루로 나누는 이유는 KST에 일광 절약이 없어 하루가 언제나
 * 24시간이기 때문이다. 이 가정이 깨지는 시간대였다면 날짜 산술로 세야 한다.
 */
function periodDays(from: Temporal.Instant, before: Temporal.Instant): number {
  return Math.round((before.epochMilliseconds - from.epochMilliseconds) / MILLISECONDS_PER_DAY);
}

export function timeResolutionOf(days: number): "day" | "week" | "month" {
  if (days <= DAY_RESOLUTION_MAX_DAYS) return "day";
  if (days <= WEEK_RESOLUTION_MAX_DAYS) return "week";
  return "month";
}

/** 요청 기간을 빈틈없이 덮는 한 조각이다. 양끝 포함이며 조각들이 겹치지도 벌어지지도 않는다. */
export interface AnalysisCoverageSegment {
  readonly from: KstDate;
  readonly to: KstDate;
  readonly target: MartCoverage;
  readonly comparison: MartCoverage;
}

/**
 * 달을 자리로 삼되 **양끝은 요청 기간으로 잘라 낸다.** 조각들이 `period.from`에서 시작해 `period.to`에서
 * 끝나며 이어 붙어야 한다는 것이 계약의 규칙이다 — 달을 통째로 실으면 7월 15일부터 물었는데 7월 1일부터
 * 답한 것이 되고, 그 조각은 사용자가 묻지 않은 구간의 수집 상태다.
 *
 * 행이 없는 달을 빼지 않는 이유는 "그 달은 조건에 맞는 판이 없었다"와 "그 달은 아직 수집되지 않았다"를
 * 화면이 구별해야 하기 때문이다. 행이 없는 달의 보유율은 `none`이다(PDR-0003).
 */
export function coverageSegments(
  period: AnalysisPeriodInput,
  months: readonly KstMonth[],
  read: readonly AnalysisMonthCoverage[],
): readonly AnalysisCoverageSegment[] {
  const byMonth = new Map(read.map((entry) => [entry.month, entry] as const));
  const missing: MartCoverage = "none";
  return months.map((month, index) => {
    const entry = byMonth.get(month);
    return {
      from: index === 0 ? period.from : kstDate(kstMonthFirstDayText(month)),
      to: index === months.length - 1 ? period.to : kstDate(kstMonthLastDayText(month)),
      target: entry?.target ?? missing,
      comparison: entry?.comparison ?? missing,
    };
  });
}

export class FindAnalysisTimeSeries {
  constructor(private readonly reader: AnalysisTimeSeriesReader, private readonly clock: Clock) {}

  execute(input: FindAnalysisTimeSeriesInput): Effect.Effect<
    AnalysisTimeSeriesResult,
    ProcurementDependencyUnavailable | OrganizationNotFound | AnalysisRegionNotFound,
    never
  > {
    const from = kstDayStart(input.period.from);
    const before = kstDayAfter(input.period.to);
    const timeResolution = timeResolutionOf(periodDays(from, before));
    // 존재 확인을 먼저 끝내야 "그 축이 없음"과 "표본이 아직 없음"이 같은 빈 결과로 뭉개지지 않는다.
    return this.assertAxesExist(input).pipe(
      Effect.flatMap(() => Effect.tryPromise({
        try: () => this.reader.readTimeSeries({
          targetOrganizationId: input.targetOrganizationId,
          excludeAttemptId: input.excludeAttemptId,
          from,
          before,
          dateBasis: input.dateBasis,
          floorRateMilli: rateTextMilli(input.floorRate),
          awardMethodCodeValueId: input.awardMethodCodeValueId,
          listCountMin: input.listCountMin,
          listCountMax: input.listCountMax,
          targetItemCodeValueId: input.targetItemCodeValueId,
          comparisonScope: input.comparisonScope,
          timeResolution,
          rateBinWidthMilli: RATE_BIN_WIDTH_MILLI,
          targetPointLimit: TARGET_POINT_LIMIT,
          comparisonPointLimit: COMPARISON_POINT_LIMIT,
        }),
        catch: (cause) => new ProcurementDependencyUnavailable(cause),
      })),
      Effect.map((reading) => this.assemble(input, timeResolution, reading)),
    );
  }

  /** 기관과 비교 지역을 함께 확인한다. 전국은 확인할 축이 없으므로 조회를 한 번 더 열지 않는다. */
  private assertAxesExist(input: FindAnalysisTimeSeriesInput): Effect.Effect<
    void,
    ProcurementDependencyUnavailable | OrganizationNotFound | AnalysisRegionNotFound,
    never
  > {
    const scope = input.comparisonScope;
    const organization = this.exists(
      () => this.reader.organizationExists(input.targetOrganizationId),
      () => new OrganizationNotFound(input.targetOrganizationId),
    );
    if (scope.kind === "national") return organization;
    return organization.pipe(Effect.flatMap(() => this.exists(
      () => this.reader.regionExists(scope.scheme, scope.codeValueId),
      () => new AnalysisRegionNotFound(scope.scheme, scope.codeValueId),
    )));
  }

  private exists<Failure>(
    read: () => Promise<boolean>,
    missing: () => Failure,
  ): Effect.Effect<void, ProcurementDependencyUnavailable | Failure, never> {
    return Effect.tryPromise({
      try: read,
      catch: (cause): ProcurementDependencyUnavailable => new ProcurementDependencyUnavailable(cause),
    }).pipe(Effect.flatMap((found) => found ? Effect.succeed(undefined) : Effect.fail(missing())));
  }

  private assemble(
    input: FindAnalysisTimeSeriesInput,
    timeResolution: "day" | "week" | "month",
    reading: AnalysisTimeSeriesReading,
  ): AnalysisTimeSeriesResult {
    // 활성 build가 없으면 계보도 스냅샷도 없다. 오류가 아니라 파생물이 아직 없는 상태다(ADR 0011).
    if (reading.lineage === null || reading.sourceCutoffAt === null) {
      return { state: "unavailable", input, reason: "snapshot-unavailable" };
    }
    const issuedAt = this.clock.now();
    const months = kstMonthsBetween(kstMonthOf(kstDayStart(input.period.from)), kstMonthOf(kstDayStart(input.period.to)));
    return {
      state: "ready",
      input,
      axis: {
        timeResolution,
        rateBinWidthMilli: reading.comparison.kind === "density" ? RATE_BIN_WIDTH_MILLI : null,
      },
      snapshot: {
        sourceCutoffAt: reading.sourceCutoffAt,
        issuedAt,
        expiresAt: issuedAt.add({ hours: SNAPSHOT_TTL_HOURS }),
        observationPolicyVersion: OBSERVATION_POLICY_VERSION,
        lineage: reading.lineage,
      },
      targetPoints: reading.targetPoints,
      targetTotal: reading.targetTotal,
      targetTruncated: reading.targetPoints.length < reading.targetTotal,
      comparison: reading.comparison,
      comparisonTruncated: reading.comparisonTruncated,
      comparisonTotal: reading.comparisonTotal,
      overlapCount: reading.overlapCount,
      coverage: coverageSegments(input.period, months, reading.coverage),
    };
  }
}
