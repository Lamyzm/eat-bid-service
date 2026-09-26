/**
 * @module 책임: 캔버스 위 누른 자리에서 가장 가까운 기관 낙찰점 하나를 고른다. 그리기와 같은 좌표 규칙을 쓴다.
 */
import type { TimeSeriesDomain, TimeSeriesPoint } from './present-time-series';

export interface PlotBox {
  readonly width: number;
  readonly height: number;
  readonly pad: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
}

/**
 * 누른 자리가 점에서 이만큼 안이면 그 점을 고른 것으로 본다(px). 점 반지름(4.5px)보다 넉넉히 잡는 이유는
 * 손가락과 트랙패드로도 한 번에 집혀야 해서다. 더 넓히면 겹친 이웃 점을 잘못 집는다.
 */
const HIT_RADIUS = 10;

function scale(value: number, from: number, to: number, size: number): number {
  return to === from ? size / 2 : ((value - from) / (to - from)) * size;
}

/** 캔버스 안 좌표(px)의 가장 가까운 점이다. 반경 밖이거나 축 밖 점뿐이면 null이다. */
export function nearestTargetPoint(
  points: readonly TimeSeriesPoint[],
  view: TimeSeriesDomain,
  box: PlotBox,
  x: number,
  y: number
): TimeSeriesPoint | null {
  const plotWidth = Math.max(box.width - box.pad.left - box.pad.right, 1);
  const plotHeight = Math.max(box.height - box.pad.top - box.pad.bottom, 1);
  let best: TimeSeriesPoint | null = null;
  let bestDistance = HIT_RADIUS * HIT_RADIUS;
  for (const point of points) {
    // 축 밖에 있어 그려지지 않은 점은 집지 않는다. 안 보이는 점이 눌리면 사용자는 무엇을 연 것인지 모른다.
    if (point.y < view.yFrom || point.y > view.yTo) continue;
    const px = box.pad.left + scale(point.x, view.xFrom, view.xTo, plotWidth);
    const py = box.pad.top + plotHeight - scale(point.y, view.yFrom, view.yTo, plotHeight);
    const distance = (px - x) ** 2 + (py - y) ** 2;
    if (distance <= bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}
