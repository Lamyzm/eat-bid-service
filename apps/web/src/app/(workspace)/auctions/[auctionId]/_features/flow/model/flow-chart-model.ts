/** @module 책임: 기관 회차를 동일 조건의 추이 구간과 KST 달력 좌표로 바꾸며 원문 값과 중복 날짜를 보존한다. */
import type { UTCTimestamp } from 'lightweight-charts';
import type { HistoryPresentation, HistoryRow } from '@/app/(workspace)/auctions/[auctionId]/_features/history/model/attempt-history';
import type { OwnChartPoint } from '@/app/(workspace)/auctions/[auctionId]/_features/own-bid/model/own-bid-points';

export type FlowChartPoint = { readonly time: UTCTimestamp; readonly value: number; readonly row: HistoryRow };
export type FlowChartSeries = { readonly points: readonly FlowChartPoint[]; readonly connected: boolean };
export type FlowChartModel = {
  readonly points: readonly FlowChartPoint[];
  readonly series: readonly FlowChartSeries[];
  readonly calendar: readonly { readonly time: UTCTimestamp }[];
  readonly initialRange: { readonly from: number; readonly to: number } | null;
};

// 원문 시각을 UTC로 바꾸는 함수가 아니다. 서버가 계산한 KST 달력 날짜를 라이브러리의 하루 좌표에
// 놓는다. 같은 날의 회차는 같은 x를 유지하며 순서를 만들기 위한 가짜 초/밀리초를 더하지 않는다.
// 내 투찰 점도 같은 함수로 x를 놓아야 같은 날의 낙찰 점과 겹친다.
export function chartDay(dayOrdinal: number): UTCTimestamp {
  return (dayOrdinal * 86400) as UTCTimestamp;
}

/** 캔버스 위 후보 하나. 낙찰 점과 내 투찰 점은 같은 날 같은 값에 겹칠 수 있어 종류를 이름으로 나눈다. */
export type FlowInspection =
  | { readonly kind: 'win'; readonly point: FlowChartPoint }
  | { readonly kind: 'own'; readonly point: OwnChartPoint };

// 품목은 원자 집합이라 "같은 품목"은 집합이 같다는 뜻이다. 미관측(null)과 어휘 밖(빈 집합)은 어느 회차와도
// 같은 조건이 아니다 — 모르는 것을 같다고 잇지 않는다(AGENTS 3).
function itemsKey(row: HistoryRow): string | null {
  return row.items === null || row.items.length === 0 ? null : [...row.items].sort().join('|');
}

function sameConditions(a: HistoryRow, b: HistoryRow): boolean {
  const key = itemsKey(a);
  return key !== null && a.floorRateText !== null && a.awardMethodCodeValueId != null
    && key === itemsKey(b) && a.floorRateText === b.floorRateText
    && a.awardMethodCodeValueId === b.awardMethodCodeValueId;
}

export function flowObservedRange(points: readonly FlowChartPoint[], includeSecond: boolean) {
  const values = points.flatMap((point) => [point.value, ...(includeSecond && point.row.secondRateText !== null ? [Number(point.row.secondRateText)] : [])]);
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max(0.01, (high - low) * 0.08);
  return { from: Math.max(0, low - padding), to: high + padding };
}

export function buildFlowChartModel(presentation: HistoryPresentation): FlowChartModel {
  const rows = presentation.rows.filter((row) => row.openedAt != null).toSorted((a, b) => a.openedKstDay - b.openedKstDay);
  const groups: HistoryRow[][] = [];
  for (const row of rows) {
    const group = groups.find((candidate) => sameConditions(candidate[0]!, row));
    if (group) group.push(row); else groups.push([row]);
  }
  const points: FlowChartPoint[] = [];
  const series: FlowChartSeries[] = [];
  for (const group of groups) {
    let segment: FlowChartPoint[] = [];
    const flush = () => { if (segment.length) series.push({ points: segment, connected: segment.length > 1 }); segment = []; };
    for (const row of group) {
      const duplicateDay = group.filter((candidate) => candidate.openedKstDay === row.openedKstDay).length > 1;
      if (row.winRateText === null) { flush(); continue; }
      // Number는 렌더링 좌표에서만 쓴다. tooltip과 표는 row의 exact 문자열을 그대로 읽는다.
      const point = { time: chartDay(row.openedKstDay), value: Number(row.winRateText), row };
      points.push(point);
      if (duplicateDay || !sameConditions(row, row)) {
        flush();
        series.push({ points: [point], connected: false });
      } else segment.push(point);
    }
    flush();
  }
  points.sort((a, b) => a.time - b.time);
  const first = rows[0]?.openedKstDay;
  const last = rows.at(-1)?.openedKstDay;
  // API의 최대 60개월은 윤년을 포함해 1,827일 이하다. 빈 날도 축에 남겨 1일과 1개월 간격이
  // 같은 폭으로 보이지 않게 한다. 계약 밖으로 긴 fixture는 원래 점을 보존하고 빈 날 확장만 제한한다.
  const calendar = first === undefined || last === undefined ? [] : last - first > 1830
    ? [...new Set(rows.map((row) => chartDay(row.openedKstDay)))].map((time) => ({ time }))
    : Array.from({ length: last - first + 1 }, (_, index) => ({ time: chartDay(first + index) }));
  const floor = presentation.cohort?.floorRate;
  const initialRange = floor?.kind === 'exact'
    ? { from: Math.max(0, Number(floor.value.value) - 0.1), to: Number(floor.value.value) + 0.7 }
    : flowObservedRange(points, false);
  return { points, series, calendar, initialRange };
}
