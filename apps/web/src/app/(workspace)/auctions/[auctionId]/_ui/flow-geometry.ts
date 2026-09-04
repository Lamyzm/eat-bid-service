/** @module 책임: 회차별 낙찰률 흐름 SVG의 고정 사정률 창과 점·눈금·창 밖 표시 좌표를 순수 함수로 계산한다. */
import type { HistoryRow } from '../_model/attempt-history';
import { toMilli } from '../_model/bid-rate';

export const FLOW_VIEW_WIDTH = 784;
export const FLOW_VIEW_HEIGHT = 240;

const AXIS_LABEL_WIDTH = 56;
const PAD_Y = 16;
const PLOT_TOP = PAD_Y;
const PLOT_BOTTOM = FLOW_VIEW_HEIGHT - PAD_Y;
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
  readonly selected: boolean;
  readonly floorY: number | null;
};

/**
 * 표시 행(최근 → 오래된)을 시간축(왼쪽이 오래된 회차)으로 뒤집는다. 낙찰률이 없는 회차는 y를 만들
 * 수 없으므로 점을 만들지 않고 축 간격에서도 뺀다. 그날 하한은 창 밖이면 그리지 않는다. 경계에
 * 붙인 짧은 눈금은 창 경계값에서 실제로 관측된 하한처럼 읽히고 정확한 값은 표에 이미 있다.
 */
export function flowPoints(rows: readonly HistoryRow[]): readonly FlowPoint[] {
  const chronological = rows
    .toReversed()
    .filter((row): row is HistoryRow & { winRateMilli: bigint; winRateText: string } =>
      row.winRateMilli !== null && row.winRateText !== null
    );

  return chronological.map((row, index) => {
    const placement = placeMilli(row.winRateMilli);
    const floor = row.dayFloorMilli === null ? null : placeMilli(row.dayFloorMilli);
    return {
      key: row.attemptId,
      x: plotX(index, chronological.length),
      y: placement.y,
      outside: placement.outside,
      rateText: row.winRateText,
      selected: row.isSelectedItem,
      floorY: floor && floor.outside === null ? floor.y : null
    };
  });
}

/** 내 값 수평선도 같은 창 규칙을 쓴다. 창 밖이면 경계에 붙어 방향만 알린다. */
export function myRatePlacement(rate: string): FlowPlacement {
  return placeMilli(toMilli(rate));
}
