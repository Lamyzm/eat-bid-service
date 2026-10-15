/**
 * @module 책임: 달별 보기의 표 줄(이번 달·지난 달마다 가장 많이 나온 칸)과 산 모양 그림의 달 목록을 만든다.
 *
 * 공고가 적은 달도 줄에서 빼지 않는다. 빼면 그 달이 없던 것처럼 읽힌다 — 칸을 고르지 않은 까닭(건수)을 그 줄에 적는다.
 */
import type { FloorPeriod } from '@/entities/floor-line/floor-period';
import { MIN_MONTH_COUNT, monthBands, type MonthBand } from '@/app/(workspace)/floor/_lib/floor-stats';
import { manText, monthLabel, monthNumber, rateText } from '@/entities/floor-line/floor-units';
import type { FloorPoint } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';

export type MonthRow =
  | { readonly kind: 'band'; readonly month: string; readonly label: string; readonly cells: readonly [string, string, string, string] }
  | { readonly kind: 'thin'; readonly month: string; readonly label: string; readonly note: string };

export interface MonthsView {
  readonly current: { readonly label: string; readonly text: string };
  readonly rows: readonly MonthRow[];
  /** 산 모양 그림에 그릴 최근 달(공고가 넉넉한 달만, 최근 순)이다. */
  readonly ridgeMonths: readonly MonthBand[];
}

export function presentMonths(points: readonly FloorPoint[], period: FloorPeriod, width: number): MonthsView {
  const bands = monthBands(points, width);
  const now = bands.find((band) => band.month === period.currentMonth);
  const past = bands.filter((band) => band.month !== period.currentMonth).toReversed();
  const current = {
    label: monthLabel(period.currentMonth),
    text:
      now !== undefined && now.count >= MIN_MONTH_COUNT
        ? `이번 달 · 개찰 끝난 ${now.count}건, 사정률 ${rateText(now.lo, 1)}~${rateText(now.hi, 1)}에 ${now.inside}건`
        : `이번 달(${monthNumber(period.currentMonth)}월) · 개찰 끝난 ${now?.count ?? 0}건. 개찰되는 대로 채워져요`
  };
  const rows = past.map((band): MonthRow => {
    if (band.count < MIN_MONTH_COUNT) {
      return { kind: 'thin', month: band.month, label: monthLabel(band.month), note: `공고 ${band.count}건이라 칸을 고르지 않았어요` };
    }
    return {
      kind: 'band',
      month: band.month,
      label: monthLabel(band.month),
      cells: [
        `${rateText(band.lo, 2)}~${rateText(band.hi, 2)}`,
        `${band.count}건 중 ${band.inside}건 (${Math.round((100 * band.inside) / band.count)}%)`,
        `${band.lo.toFixed(1)}~${band.hi.toFixed(1)}%`,
        `${manText((100_000_000 * band.lo) / 100)}~${manText((100_000_000 * band.hi) / 100)} 원`
      ]
    };
  });
  return { current, rows, ridgeMonths: past.filter((band) => band.count >= MIN_MONTH_COUNT).slice(0, 12) };
}
