/** @module 책임: 분석 시간축 결과(milli 정수 점·칸)를 공개 V1 응답의 십진 문자열 봉투로 직렬화한다. */
import type {
  AnalysisComparisonSeries,
  AnalysisDensityCell,
  AnalysisFilterValue,
  AnalysisMeta,
  AnalysisSnapshot,
  AnalysisTargetPoint,
  AnalysisTimeSeriesV1Response,
} from "@eatbid/contracts";
import { bidRateWire, bigintText, instantText } from "../../../../platform/http/wire";
import type {
  AnalysisDensityCellRecord,
  AnalysisPointRecord,
} from "../../application/analysis-time-series-reader";
import { rateMilliText } from "../../application/distribution-statistics";
import type {
  AnalysisSnapshotResult,
  AnalysisTimeSeriesReady,
  AnalysisTimeSeriesResult,
  FindAnalysisTimeSeriesInput,
} from "../../application/find-analysis-time-series";
import { KST_TIME_ZONE } from "../../domain/kst-month";

// 사정률 봉투는 milli 정수에서 만든 십진 문자열이라 축별 wire helper를 거치지 않는다.
function rateWire(milli: bigint) {
  return { value: rateMilliText(milli), unit: "percentage-points" } as const;
}

function pointResource(point: AnalysisPointRecord): AnalysisTargetPoint {
  return {
    attemptId: bigintText(point.attemptId),
    revisionId: bigintText(point.revisionId),
    plottedAt: instantText(point.plottedAt),
    assessmentRate: rateWire(point.assessmentRateMilli),
  };
}

/**
 * 칸의 오른쪽 끝은 저장하지 않고 폭에서 만든다. 두 끝을 따로 실으면 어느 한쪽만 바뀌는 순간 칸이
 * 겹치거나 벌어지고, 그때 밀도 합이 표본 수와 달라진 이유를 화면에서 찾을 수 없다.
 */
function cellResource(cell: AnalysisDensityCellRecord, widthMilli: bigint, timeToAt: string): AnalysisDensityCell {
  return {
    fromAt: instantText(cell.fromAt),
    toAt: timeToAt,
    rateFrom: rateWire(cell.rateFromMilli),
    rateTo: rateWire(cell.rateFromMilli + widthMilli),
    count: cell.count,
  };
}

/**
 * 시간 칸의 오른쪽 끝이다. 달·주·일의 길이가 서로 달라 폭을 상수로 더할 수 없으므로 달력 단위로 옮긴다.
 * KST 벽시계에서 옮기는 이유는 조회가 KST로 잘랐기 때문이며, UTC로 더하면 서머타임이 없어도 달의 길이가
 * 어긋나 칸 하나가 이웃과 겹친다.
 */
function nextBucketText(cell: AnalysisDensityCellRecord, resolution: "day" | "week" | "month"): string {
  const zoned = cell.fromAt.toZonedDateTimeISO(KST_TIME_ZONE);
  const shifted = resolution === "month"
    ? zoned.add({ months: 1 })
    : zoned.add({ days: resolution === "week" ? 7 : 1 });
  return instantText(shifted.toInstant());
}

function comparisonResource(ready: AnalysisTimeSeriesReady): AnalysisComparisonSeries {
  if (ready.comparison.kind === "points") {
    return { kind: "points", points: ready.comparison.points.map(pointResource), truncated: false };
  }
  // 밀도로 낼 때만 폭이 있다. 축이 폭을 null로 말하는 상태와 칸이 있는 상태가 어긋나면 화면이 칸의
  // 오른쪽 끝을 스스로 지어내게 된다.
  const widthMilli = ready.axis.rateBinWidthMilli ?? 0n;
  return {
    kind: "density",
    cells: ready.comparison.cells.map((cell) =>
      cellResource(cell, widthMilli, nextBucketText(cell, ready.axis.timeResolution))),
    truncated: ready.comparisonTruncated,
  };
}

function filterResource(input: FindAnalysisTimeSeriesInput): AnalysisFilterValue {
  return {
    targetOrganizationId: bigintText(input.targetOrganizationId),
    excludeAttemptId: bigintText(input.excludeAttemptId),
    period: { from: input.period.from, to: input.period.to },
    dateBasis: input.dateBasis,
    comparisonScope: input.comparisonScope.kind === "national"
      ? { kind: "national" }
      : {
        kind: "region",
        scheme: input.comparisonScope.scheme,
        codeValueId: bigintText(input.comparisonScope.codeValueId),
      },
    floorRate: bidRateWire(input.floorRate),
    awardMethodCodeValueId: bigintText(input.awardMethodCodeValueId),
    listCountRange: { min: input.listCountMin, max: input.listCountMax },
    // 포트는 읽기 전용 배열이고 wire 타입은 그렇지 않다. 같은 값을 복사해 경계에서만 형태를 맞춘다.
    itemFilter: input.itemFilter.kind === "atoms"
      ? { kind: "atoms", atoms: [...input.itemFilter.atoms], unknown: input.itemFilter.unknown }
      : input.itemFilter,
  };
}

/**
 * 읽은 build 하나만 싣는다. 읽지 않은 분포 mart의 계보를 함께 실으면 이 답이 그것에 의존한다고 말하는
 * 것이고, 그 mart가 회수되면 무관한 이유로 응답이 깨진다(EAT-198 측정).
 */
function snapshotResource(snapshot: AnalysisSnapshotResult): AnalysisSnapshot {
  return {
    sourceCutoffAt: instantText(snapshot.sourceCutoffAt),
    issuedAt: instantText(snapshot.issuedAt),
    expiresAt: instantText(snapshot.expiresAt),
    observationPolicyVersion: snapshot.observationPolicyVersion,
    builds: [{
      purpose: "observations",
      lineage: {
        buildId: bigintText(snapshot.lineage.buildId),
        sourceReleaseId: snapshot.lineage.sourceReleaseId,
        calcVersion: snapshot.lineage.calcVersion,
        computedAt: instantText(snapshot.lineage.computedAt),
        coverage: snapshot.lineage.coverage ?? "unknown",
        regionScheme: snapshot.lineage.regionScheme,
      },
    }],
  };
}

function metaResource(ready: AnalysisTimeSeriesReady): AnalysisMeta {
  return {
    state: "ready",
    effectiveFilter: filterResource(ready.input),
    snapshot: snapshotResource(ready.snapshot),
    targetSampleCount: ready.targetTotal,
    comparisonSampleCount: ready.comparisonTotal,
    overlapCount: ready.overlapCount,
    // 달마다 한 줄이다. 기간 전체를 한 줄로 접으면 어느 달이 덜 수집됐는지가 사라지고, 화면은 5년 전체를
    // 같은 신뢰도로 그린다.
    periodCoverage: ready.coverage.map((entry) => ({
      period: { from: entry.from, to: entry.to },
      target: entry.target,
      comparison: entry.comparison,
    })),
    // 수집 지연을 아직 확인하지 않는다. 확인하지 않은 것을 `current`로 적으면 화면이 최신이라고 말한다.
    freshness: { state: "unknown", checkedAt: null },
  };
}

export function toAnalysisTimeSeriesResponse(result: AnalysisTimeSeriesResult): AnalysisTimeSeriesV1Response {
  if (result.state === "unavailable") {
    // 축도 점도 비교군도 없다. 표본 수를 0으로 채우지 않는 이유는 관측된 0건과 미발행이 사용자에게
    // 다른 사실이기 때문이다(AGENTS 3).
    return {
      axis: null,
      target: null,
      targetTruncated: false,
      comparison: null,
      meta: { state: "unavailable", effectiveFilter: filterResource(result.input), reason: result.reason },
    };
  }
  return {
    axis: {
      period: { from: result.input.period.from, to: result.input.period.to },
      timeResolution: result.axis.timeResolution,
      rateBinWidth: result.axis.rateBinWidthMilli === null ? null : rateWire(result.axis.rateBinWidthMilli),
    },
    target: result.targetPoints.map(pointResource),
    targetTruncated: result.targetTruncated,
    comparison: comparisonResource(result),
    meta: metaResource(result),
  };
}
