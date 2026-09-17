/** @module 책임: 분석 시간축 응답을 화면이 고르기만 하면 되는 표시 모델 union과 그리기용 순수 좌표로 옮긴다. */
import { Temporal } from '@eatbid/domain';
import type {
  AnalysisTimeSeriesV1Response,
  AnalysisTargetPoint
} from '@eatbid/contracts/api/v1/analysis';

/** 그릴 점 하나다. `x`는 epoch 밀리초, `y`는 사정률 milli 정수다. */
export interface TimeSeriesPoint {
  readonly x: number;
  readonly y: number;
  readonly attemptId: string;
  readonly revisionId: string;
  readonly label: string;
}

/** 밀도 칸 하나다. 두 축 모두 반개구간이라 오른쪽·위쪽 끝은 다음 칸의 시작과 같다. */
export interface TimeSeriesCell {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly count: number;
}

export interface TimeSeriesDomain {
  readonly xFrom: number;
  readonly xTo: number;
  readonly yFrom: number;
  readonly yTo: number;
}

export type TimeSeriesComparison =
  | { readonly kind: 'points'; readonly points: readonly TimeSeriesPoint[] }
  | { readonly kind: 'density'; readonly cells: readonly TimeSeriesCell[]; readonly maxCount: number };

export interface TimeSeriesPlot {
  readonly domain: TimeSeriesDomain;
  readonly target: readonly TimeSeriesPoint[];
  readonly comparison: TimeSeriesComparison;
  readonly xTicks: readonly { readonly x: number; readonly label: string }[];
  readonly yTicks: readonly { readonly y: number; readonly label: string }[];
  /** 잘려서 그리지 못한 것이 있다는 사실이다. 없으면 null이고, 있으면 그대로 화면에 적는다. */
  readonly truncation: string | null;
  readonly targetCount: number;
  readonly comparisonCount: number;
  readonly overlapCount: number;
}

/**
 * 화면이 고르기만 하면 되는 갈래다. 사용자가 할 일이 다른 만큼만 나눈다 — 조건을 고쳐야 하는 것,
 * 기다려야 하는 것, 범위를 넓혀야 하는 것은 서로 다른 상태이며 "표시할 수 없음" 하나로 뭉치면
 * 무엇을 해야 할지 알 수 없다.
 */
export type TimeSeriesView =
  | { readonly kind: 'cohort-not-found' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'plot'; readonly plot: TimeSeriesPlot };

const KST = 'Asia/Seoul';
const RATE_SCALE = 1000;

/** 소수 셋째 자리 고정 십진 문자열을 milli 정수로 옮긴다. 부동소수를 거치면 칸 경계가 흔들린다. */
function rateMilli(text: string): number {
  const match = /^(-?)([0-9]+)\.([0-9]{3})$/.exec(text);
  if (match === null) throw new RangeError(`사정률 문자열의 형태가 계약과 다릅니다: ${text}`);
  const magnitude = Number(match[2]) * RATE_SCALE + Number(match[3]);
  return match[1] === '-' ? -magnitude : magnitude;
}

function rateText(milli: number): string {
  const sign = milli < 0 ? '-' : '';
  const magnitude = Math.abs(milli);
  return `${sign}${Math.floor(magnitude / RATE_SCALE)}.${String(magnitude % RATE_SCALE).padStart(3, '0')}`;
}

function epochOf(instantText: string): number {
  return Temporal.Instant.from(instantText).epochMilliseconds;
}

function kstDayText(epochMilliseconds: number): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toZonedDateTimeISO(KST);
  return `${zoned.year}-${String(zoned.month).padStart(2, '0')}-${String(zoned.day).padStart(2, '0')}`;
}

function targetPoint(point: AnalysisTargetPoint): TimeSeriesPoint {
  const x = epochOf(point.plottedAt);
  return {
    x,
    y: rateMilli(point.assessmentRate.value),
    attemptId: point.attemptId,
    revisionId: point.revisionId,
    label: `${kstDayText(x)} 사정률 ${point.assessmentRate.value}%`
  };
}

/**
 * 사정률 축의 범위다. 두 집단의 관측을 모두 덮어야 한다 — 기관 점만 보고 잡으면 비교군의 극단값이
 * 그림 밖으로 나가고, 화면은 "범위 밖 극단값을 숨기지 않는다"는 약속을 어긴다(EAT-216 acceptance 4).
 *
 * 관측이 한 점뿐이면 폭이 0이라 나눌 수 없으므로 최소 폭을 준다. 그 최소 폭은 사정률 칸 하나(0.1%p)의
 * 열 배이며, 한 점짜리 그림에서 눈금이 한 칸도 서지 않는 것을 막는 자리다.
 */
function rateDomain(values: readonly number[]): { readonly yFrom: number; readonly yTo: number } {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, 1_000);
  const pad = Math.round(span * 0.08);
  return { yFrom: low - pad, yTo: high + pad };
}

/** 눈금은 다섯 자리를 넘지 않게 고른다. 더 촘촘하면 라벨이 겹치고 더 성기면 값을 읽을 수 없다. */
function ticks<Value>(from: number, to: number, count: number, make: (value: number) => Value): Value[] {
  if (!(to > from)) return [make(from)];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, index) => make(from + step * index));
}

export function presentTimeSeries(
  read: { readonly kind: 'cohort-not-found' } | { readonly kind: 'series'; readonly response: AnalysisTimeSeriesV1Response }
): TimeSeriesView {
  if (read.kind === 'cohort-not-found') return { kind: 'cohort-not-found' };
  const { axis, target, comparison, meta, targetTruncated } = read.response;
  if (meta.state !== 'ready' || axis === null || target === null || comparison === null) {
    return {
      kind: 'unavailable',
      reason: meta.state === 'ready' ? '자료 기준을 확인하지 못했어요.' : reasonText(meta.reason)
    };
  }
  const targetPoints = target.map(targetPoint);
  const comparisonPoints = comparison.kind === 'points' ? comparison.points.map(targetPoint) : [];
  const cells: TimeSeriesCell[] = comparison.kind === 'density'
    ? comparison.cells.map((cell) => ({
      x0: epochOf(cell.fromAt),
      x1: epochOf(cell.toAt),
      y0: rateMilli(cell.rateFrom.value),
      y1: rateMilli(cell.rateTo.value),
      count: cell.count
    }))
    : [];
  const rates = [
    ...targetPoints.map((point) => point.y),
    ...comparisonPoints.map((point) => point.y),
    ...cells.flatMap((cell) => [cell.y0, cell.y1])
  ];
  // 두 집단이 모두 비었으면 그릴 축이 없다. 빈 그림에 눈금만 그려 두면 조건에 맞는 관측이 없다는
  // 사실이 그림의 여백으로 밀려난다.
  if (rates.length === 0) return { kind: 'empty' };
  const xFrom = epochOf(`${axis.period.from}T00:00:00+09:00`);
  const xTo = epochOf(`${axis.period.to}T23:59:59+09:00`);
  const { yFrom, yTo } = rateDomain(rates);
  return {
    kind: 'plot',
    plot: {
      domain: { xFrom, xTo, yFrom, yTo },
      target: targetPoints,
      comparison: comparison.kind === 'points'
        ? { kind: 'points', points: comparisonPoints }
        : { kind: 'density', cells, maxCount: Math.max(...cells.map((cell) => cell.count)) },
      xTicks: ticks(xFrom, xTo, 5, (x) => ({ x, label: kstDayText(x) })),
      yTicks: ticks(yFrom, yTo, 5, (y) => ({ y, label: rateText(Math.round(y)) })),
      truncation: truncationText(targetTruncated, comparison.truncated),
      targetCount: meta.targetSampleCount,
      comparisonCount: meta.comparisonSampleCount,
      overlapCount: meta.overlapCount
    }
  };
}

function reasonText(reason: 'snapshot-unavailable' | 'snapshot-expired' | 'input-unconfirmed'): string {
  if (reason === 'input-unconfirmed') return '이 조건의 입력을 아직 확인하지 못했어요.';
  if (reason === 'snapshot-expired') return '자료 기준이 만료됐어요. 다시 조회해 주세요.';
  return '이 조건의 분석 자료가 아직 만들어지지 않았어요.';
}

/**
 * 잘린 사실은 그림이 아니라 글로 말한다. 임의로 자르고 전체인 척하지 않으며, 사용자가 할 일(범위를
 * 좁히는 것)을 함께 적는다(EAT-216 acceptance 1·4).
 */
function truncationText(targetTruncated: boolean, comparisonTruncated: boolean): string | null {
  if (targetTruncated && comparisonTruncated) return '기관과 비교군 모두 일부만 그렸어요. 기간을 좁혀 주세요.';
  if (targetTruncated) return '기관 기록이 많아 일부만 그렸어요. 기간을 좁혀 주세요.';
  if (comparisonTruncated) return '비교군이 많아 일부만 그렸어요. 기간을 좁혀 주세요.';
  return null;
}
