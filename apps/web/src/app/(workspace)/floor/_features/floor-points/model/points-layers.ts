/**
 * @module 책임: 공고별 보기의 겹쳐 볼 층(달마다 가장 많이 나온 칸, 실제 투찰 1~10등, 우리 값)과 보이는 기간의 칸별 건수·요약 문장을 만든다.
 *
 * 층은 모두 점 목록의 번호로 공고를 가리킨다. 그림에서 어느 점을 눌러도 같은 공고 카드가 열려야 해서다.
 */
import type { FloorPeriod } from '@/entities/floor-line/floor-period';
import { hottestBand, MIN_MONTH_COUNT, monthBands } from '@/app/(workspace)/floor/_lib/floor-stats';
import { quantileOf } from '@/entities/floor-line/floor-range';
import { countText, rateText } from '@/entities/floor-line/floor-units';
import type { FloorData, FloorPoint } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';

/** 그림 세로축의 양 끝(기초금액 대비 %)이다. 하한선은 기초금액 ±3.1% × 0.9 안에 든다. */
export const AXIS_LOW = 87.5;
export const AXIS_HIGH = 92.5;

/** `[달 시작, 다음 달 시작, 칸 아래, 칸 위]` */
export type BandRect = readonly [number, number, number, number];
/** `[개찰 시각, 값, 점 번호, 등수 또는 투찰 번호]` */
export type LayerDot = readonly [number, number, number, number];

export function bandRects(points: readonly FloorPoint[], period: FloorPeriod, width: number): BandRect[] {
  const rects: BandRect[] = [];
  for (const band of monthBands(points, width)) {
    if (band.count < MIN_MONTH_COUNT) continue;
    const start = period.monthStarts[band.month];
    const next = Object.entries(period.monthStarts).find(([month]) => month > band.month)?.[1];
    if (start === undefined || next === undefined) continue;
    rects.push([start, next, band.lo, band.hi]);
  }
  return rects;
}

function indexByAttempt(points: readonly FloorPoint[]): Map<string, number> {
  return new Map(points.map((point, index) => [point.attemptId, index]));
}

export function ladderDots(points: readonly FloorPoint[], ladders: FloorData['ladders']): LayerDot[] {
  if (ladders === null) return [];
  const index = indexByAttempt(points);
  const dots: LayerDot[] = [];
  for (const ladder of ladders) {
    const at = index.get(ladder.attemptId);
    if (at === undefined) continue;
    ladder.lowest.forEach((value, rank) => dots.push([points[at]!.t, value, at, rank + 1]));
  }
  return dots;
}

export interface MineDots {
  readonly valid: readonly LayerDot[];
  readonly below: readonly LayerDot[];
  readonly won: readonly LayerDot[];
}

export function mineDots(points: readonly FloorPoint[], mine: FloorData['mine']): MineDots {
  const valid: LayerDot[] = [];
  const below: LayerDot[] = [];
  const won: LayerDot[] = [];
  if (mine.kind !== 'bids') return { valid, below, won };
  const index = indexByAttempt(points);
  mine.bids.forEach((bid, bidIndex) => {
    const at = index.get(bid.attemptId);
    if (at === undefined) return;
    const dot: LayerDot = [points[at]!.t, bid.rate, at, bidIndex];
    if (bid.outcome.kind === 'below-floor') below.push(dot);
    else if (bid.outcome.won) won.push(dot);
    else valid.push(dot);
  });
  return { valid, below, won };
}

/** `[칸 아래, 칸 위, 건수]` */
export type HistogramBin = readonly [number, number, number];

export interface WindowSummary {
  readonly histogram: readonly HistogramBin[];
  readonly headline: string;
  readonly note: string | null;
}

/**
 * 확대한 기간의 공고만으로 칸별 건수와 문장을 만든다. 가장 잦은 칸을 말할 때는 추첨만 돌려도 그만큼 든다는 말을 함께 둔다
 * — 0.2 폭 하나가 규칙상 담는 몫이 최대 약 11%라, 10% 남짓은 몰림이 아니다(PDR-0009 결정 3).
 *
 * 가장 잦은 칸은 막대 칸(87.5부터 고정 간격)이 아니라 달 띠·달별 표와 같은 계산(`hottestBand`, 0.1 눈금에서 미끄러지는 칸)으로
 * 고른다. 막대 칸으로 고르면 같은 9월이 그림 띠·표·문장에서 서로 다른 칸을 말했다(2026-10-15 리뷰).
 */
export function windowSummary(points: readonly FloorPoint[], range: readonly [number, number], width: number): WindowSummary {
  const inside = points.filter((point) => point.t >= range[0] && point.t <= range[1]);
  const bins: number[] = [];
  for (let value = AXIS_LOW; value < AXIS_HIGH - 1e-9; value += width) bins.push(Math.round(value * 10) / 10);
  const counts = bins.map(() => 0);
  for (const point of inside) {
    const slot = Math.floor((point.floor - AXIS_LOW) / width + 1e-9);
    if (slot >= 0 && slot < counts.length) counts[slot] = counts[slot]! + 1;
  }
  const histogram = bins.map((low, slot): HistogramBin => [low, Math.round((low + width) * 10) / 10, counts[slot]!]);
  if (inside.length === 0) return { histogram, headline: '이 기간에는 공고가 없어요.', note: null };
  const first = inside[0]!.date;
  const last = inside[inside.length - 1]!.date;
  const sorted = inside.map((point) => point.floor).toSorted((left, right) => left - right);
  const band = hottestBand(sorted, width);
  return {
    histogram,
    headline:
      `${first} ~ ${last} 공고 ${countText(inside.length)}건: 넓게 보면 열 번 중 다섯 번이 사정률 ` +
      `${rateText(quantileOf(sorted, 0.25), 1)}~${rateText(quantileOf(sorted, 0.75), 1)}, 그중 가장 잦은 칸은 ` +
      `사정률 ${rateText(band.lo, 2)}~${rateText(band.lo + width, 2)}(${band.inside}건, ${Math.round((100 * band.inside) / inside.length)}%)이에요.`,
    note: `추첨만 돌려도 가장 잦은 칸엔 이 정도가 들어가요(칸 하나에 ${width === 0.2 ? '10번 중 1번' : '20번 중 1번'}꼴). 특별히 몰리는 자리라는 뜻이 아니에요.`
  };
}
