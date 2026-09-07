/** @module 책임: 회차별 낙찰률 흐름 SVG의 고정 사정률 창과 낙찰·2등 점, 명단 막대, 달 라벨, 창 밖 표시의 좌표를 순수 함수로 계산한다. */
import type { HistoryRow } from '../_model/attempt-history';
import { toMilli } from '../_model/bid-rate';

export const FLOW_VIEW_WIDTH = 784;

const AXIS_LABEL_WIDTH = 56;
const PAD_Y = 16;
const PLOT_TOP = PAD_Y;
const PLOT_BOTTOM = 224;
// 막대 서브차트는 사정률 창 아래 별도 띠다. 회차별 명단 수는 건수 축이라 사정률 눈금과 같은 y로 두면
// 막대 높이가 사정률처럼 읽힌다. 위쪽 여백 30은 창 아래 눈금 글자(13px), 띠 이름(10px), 막대 위 숫자(11px)가
// 세 줄로 겹치지 않는 폭이다.
export const BAR_TOP = PLOT_BOTTOM + 30;
export const BAR_BOTTOM = BAR_TOP + 48;
export const MONTH_LABEL_Y = BAR_BOTTOM + 20;
export const FLOW_VIEW_HEIGHT = MONTH_LABEL_Y + 8;
// 점 반지름 3.5가 오른쪽 끝에서 잘리지 않게 4px만 물러선다.
export const PLOT_LEFT = AXIS_LABEL_WIDTH;
export const PLOT_RIGHT = FLOW_VIEW_WIDTH - 4;
export const TICK_LABEL_X = AXIS_LABEL_WIDTH - 8;

// 낙찰이 몰리는 폭에 맞춘 고정 창이다. 축을 관측 최소~최대로 잡으면 이상치 한 회차가 폭을 다 먹어
// 1·2등 사이 0.06%p 차이가 몇 px로 뭉개진다. 창 밖 값은 숨기지 않고 경계에 화살표로 붙인다.
const WINDOW_LOW_MILLI = BigInt(89900);
const WINDOW_HIGH_MILLI = BigInt(90700);

/** 축 눈금은 창 양끝과 0.2%p 간격 세 개다. 라벨은 회차 표와 달리 소수 한 자리만 읽는다. */
export const FLOW_TICKS = ['89.9', '90.1', '90.3', '90.5', '90.7'] as const;

/**
 * 막대 눈금의 상한이다. 명단은 보통 10~30곳에 몰리고 87·197 같은 큰 회차가 드물게 섞이므로 실측 최대로
 * 축을 잡으면 보통 회차의 막대가 납작해진다. 상한을 넘는 회차는 막대를 자르고 숫자를 위에 쓴다.
 */
export const LIST_BAR_CAP = 30;

export type FlowPlacement = {
  readonly y: number;
  readonly outside: 'above' | 'below' | null;
};

/** 창 밖 값은 잘라내지 않고 경계 y에 두되 창 밖이라는 사실을 함께 돌려준다. */
export function placeMilli(milli: bigint): FlowPlacement {
  if (milli > WINDOW_HIGH_MILLI) return { y: PLOT_TOP, outside: 'above' };
  if (milli < WINDOW_LOW_MILLI) return { y: PLOT_BOTTOM, outside: 'below' };
  const ratio = Number(milli - WINDOW_LOW_MILLI) / Number(WINDOW_HIGH_MILLI - WINDOW_LOW_MILLI);
  return { y: PLOT_BOTTOM - ratio * (PLOT_BOTTOM - PLOT_TOP), outside: null };
}

export function tickY(index: number): number {
  return PLOT_BOTTOM - (index / (FLOW_TICKS.length - 1)) * (PLOT_BOTTOM - PLOT_TOP);
}

function plotX(index: number, count: number): number {
  if (count <= 1) return (PLOT_LEFT + PLOT_RIGHT) / 2;
  return PLOT_LEFT + (index / (count - 1)) * (PLOT_RIGHT - PLOT_LEFT);
}

export type FlowPoint = {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly outside: 'above' | 'below' | null;
  readonly rateText: string;
  readonly monthText: string;
  readonly selected: boolean;
  /** 2등 사정률의 y. 없거나 창 밖이면 null — 2등은 보조 계열이라 창 밖 표시까지 겹쳐 쓰지 않고 정확한 값은 표에 둔다. */
  readonly runnerUpY: number | null;
  readonly listCount: number | null;
};

/**
 * 표시 행(최근 → 오래된)을 시간축(왼쪽이 오래된 회차)으로 뒤집는다. 낙찰률이 없는 회차는 y를 만들
 * 수 없으므로 점을 만들지 않고 축 간격에서도 뺀다. 그날 하한은 투찰률 축이라 이 창에 놓지 않는다(PDR-0004).
 */
export function flowPoints(rows: readonly HistoryRow[]): readonly FlowPoint[] {
  const chronological = rows
    .toReversed()
    .filter((row): row is HistoryRow & { winRateMilli: bigint; winRateText: string } =>
      row.winRateMilli !== null && row.winRateText !== null
    );

  return chronological.map((row, index) => {
    const placement = placeMilli(row.winRateMilli);
    const runnerUp = row.secondRateText === null ? null : placeMilli(toMilli(row.secondRateText));
    return {
      key: row.attemptId,
      x: plotX(index, chronological.length),
      y: placement.y,
      outside: placement.outside,
      rateText: row.winRateText,
      monthText: row.openedMonthText,
      selected: row.isSelectedItem,
      runnerUpY: runnerUp && runnerUp.outside === null ? runnerUp.y : null,
      listCount: row.listCount
    };
  });
}

export type ListBar = {
  readonly key: string;
  readonly x: number;
  readonly width: number;
  readonly top: number;
  /** 상한을 넘긴 회차만 숫자를 단다. 모든 막대에 달면 촘촘한 회차에서 숫자끼리 겹쳐 아무것도 못 읽는다. */
  readonly overflowText: string | null;
};

// 막대는 점 간격의 6할을 넘지 않는다. 회차가 60건이면 간격이 12px라 폭 14 고정으로는 막대가 서로 붙는다.
const BAR_MAX_WIDTH = 14;
// 세 자리 숫자(11px)가 약 20px이다. 간격이 이보다 좁으면 이웃 숫자가 한 줄로 이어져 아무 회차도 못 읽으므로
// 숫자를 모두 접고 정확한 값은 표에 맡긴다.
const OVERFLOW_TEXT_MIN_SPACING = 24;

/** 회차별 명단 수 막대. 명단을 모르는 회차는 0이 아니라 막대 없음이다 — 모름을 0으로 그리면 거짓이다(AGENTS 3). */
export function listBars(points: readonly FlowPoint[]): readonly ListBar[] {
  const spacing = points.length <= 1 ? PLOT_RIGHT - PLOT_LEFT : points[1]!.x - points[0]!.x;
  const width = Math.min(BAR_MAX_WIDTH, spacing * 0.6);
  const labelled = spacing >= OVERFLOW_TEXT_MIN_SPACING;
  return points.flatMap((point) => {
    if (point.listCount === null) return [];
    const ratio = Math.min(point.listCount, LIST_BAR_CAP) / LIST_BAR_CAP;
    return [{
      key: point.key,
      x: point.x - width / 2,
      width,
      top: BAR_BOTTOM - ratio * (BAR_BOTTOM - BAR_TOP),
      overflowText: labelled && point.listCount > LIST_BAR_CAP ? point.listCount.toString() : null
    }];
  });
}

export type MonthLabel = {
  readonly x: number;
  readonly text: string;
};

// `YY-MM` 13px 글자 폭이 약 38px이다. 이보다 가까운 달 라벨은 서로 덮이므로 뒤의 것을 건너뛴다.
const MONTH_LABEL_MIN_GAP = 46;

/** 달이 바뀌는 첫 회차 아래에 그 달 라벨을 둔다. 앞 라벨과 겹칠 만큼 가까우면 건너뛰어도 달 순서는 남는다. */
export function monthLabels(points: readonly FlowPoint[]): readonly MonthLabel[] {
  const labels: MonthLabel[] = [];
  let previousMonth: string | null = null;
  for (const point of points) {
    if (point.monthText === previousMonth) continue;
    previousMonth = point.monthText;
    const last = labels.at(-1);
    if (last && point.x - last.x < MONTH_LABEL_MIN_GAP) continue;
    labels.push({ x: point.x, text: point.monthText });
  }
  return labels;
}

/** 내 값 수평선도 같은 창 규칙을 쓴다. 창 밖이면 선을 긋지 않고 방향만 알린다. */
export function myRatePlacement(rate: string): FlowPlacement {
  return placeMilli(toMilli(rate));
}
