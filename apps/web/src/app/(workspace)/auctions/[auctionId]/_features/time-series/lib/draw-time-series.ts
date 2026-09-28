/**
 * @module 책임: 시간축 표시 모델을 캔버스 한 장에 그린다(격자·하한선·비교군·겹친 기관·기관 점·선택 고리).
 *
 * React 컴포넌트에서 떼어 낸 이유는 바뀌는 이유가 다르기 때문이다. 이쪽은 좌표와 색이고, 컴포넌트는
 * 상태·조작·축 라벨이다. 누른 자리를 되짚는 `model/time-series-hit`가 같은 `PAD`를 써야 점과 손이 맞는다.
 */
import { CHART } from '@/shared/lib/chart-colors';
import type { TimeSeriesPlot } from '../model/present-time-series';
import { floorInside } from '../model/time-series-annotations';

/** 축 라벨이 들어갈 여백이다. 캔버스 안쪽 좌표계와 바깥 눈금 라벨이 같은 값을 써야 눈금이 선과 맞는다. */
export const PAD = { left: 56, right: 12, top: 10, bottom: 26 } as const;

function scale(value: number, from: number, to: number, size: number): number {
  return to === from ? size / 2 : ((value - from) / (to - from)) * size;
}

/**
 * 밀도 칸의 진하기다. 관측 수를 최대값으로 나눈 비율을 그대로 쓰면 1건짜리 칸이 거의 보이지 않아
 * "범위 밖 극단값을 숨기지 않는다"는 약속이 눈에서 깨진다. 제곱근으로 눌러 1건도 보이게 하고 최소
 * 진하기를 준다.
 */
function cellAlpha(count: number, maxCount: number): number {
  return 0.18 + 0.72 * Math.sqrt(count / maxCount);
}

/** 밀도 점의 반지름이다. 진하기와 같은 제곱근 척도로 키워 많이 몰린 자리가 크기로도 읽히게 한다. */
function cellRadius(count: number, maxCount: number): number {
  return 1.75 + 2.25 * Math.sqrt(count / maxCount);
}

export function drawTimeSeries(
  canvas: HTMLCanvasElement,
  plot: TimeSeriesPlot,
  full: boolean,
  pinned: string | null,
  selectedAttemptId: string | null
): void {
  const view = full ? plot.fullDomain : plot.domain;
  const viewTicks = full ? plot.fullYTicks : plot.yTicks;
  const context = canvas.getContext('2d');
  if (context === null) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const plotWidth = Math.max(width - PAD.left - PAD.right, 1);
  const plotHeight = Math.max(height - PAD.top - PAD.bottom, 1);
  const { xFrom, xTo, yFrom, yTo } = view;
  const px = (x: number) => PAD.left + scale(x, xFrom, xTo, plotWidth);
  // 캔버스의 y는 아래로 자란다. 사정률은 위로 자라야 하므로 여기서 한 번만 뒤집는다.
  const py = (y: number) => PAD.top + plotHeight - scale(y, yFrom, yTo, plotHeight);

  context.strokeStyle = CHART.volume;
  context.lineWidth = 1;
  for (const tick of viewTicks) {
    const y = Math.round(py(tick.y)) + 0.5;
    context.beginPath();
    context.moveTo(PAD.left, y);
    context.lineTo(PAD.left + plotWidth, y);
    context.stroke();
  }

  if (floorInside(plot, view)) {
    const y = Math.round(py(plot.floor!.y)) + 0.5;
    context.save();
    context.strokeStyle = CHART.floor;
    context.lineWidth = 1.25;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(PAD.left, y);
    context.lineTo(PAD.left + plotWidth, y);
    context.stroke();
    context.restore();
  }

  if (plot.comparison.kind === 'density') {
    /*
     * 칸 하나를 그 가운데의 점 하나로 그린다. 칸을 면으로 채우면 세로 0.1%p·가로 한 주(또는 한 달)라 몇 %p
     * 폭의 축에서 가는 가로 막대가 되고, 운영처럼 비교군이 점 상한을 넘는 조건에서는 그림 전체가 가로줄로
     * 읽혔다(2026-09-28 사용자 보고). 점으로 그리면 비교군이 점 구름으로 읽히고, 몇 건이 몰렸는지는 크기와
     * 진하기가 말한다. 같은 주의 점이 한 세로줄에 서는 것은 서버가 그 해상도로 묶었다는 사실 그대로다.
     */
    context.fillStyle = CHART.volume;
    for (const cell of plot.comparison.cells) {
      const x = px((cell.x0 + cell.x1) / 2);
      const y = py((cell.y0 + cell.y1) / 2);
      context.globalAlpha = cellAlpha(cell.count, plot.comparison.maxCount);
      context.beginPath();
      context.arc(x, y, cellRadius(cell.count, plot.comparison.maxCount), 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  } else {
    context.strokeStyle = CHART.volume;
    context.lineWidth = 1.25;
    for (const point of plot.comparison.points) {
      context.beginPath();
      context.arc(px(point.x), py(point.y), 3.5, 0, Math.PI * 2);
      context.stroke();
    }
  }

  /*
   * 겹쳐 찍은 기관은 고리로 그린다. 여섯을 전부 채운 점으로 그리면 기관 점과 구별이 안 되고, 시안
   * 루프 실측에서 고리 174개가 기관 점을 덮었다. 그래서 기본은 흐리고, 하나를 집으면 그것만 진해진다.
   */
  for (const series of plot.overlays) {
    const focused = pinned === null || pinned === series.organizationId;
    context.strokeStyle = CHART.second;
    context.globalAlpha = focused ? 0.95 : 0.25;
    context.lineWidth = focused ? 1.75 : 1;
    for (const point of series.points) {
      context.beginPath();
      context.arc(px(point.x), py(point.y), 5, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  // 기관 점을 마지막에 그린다. 비교군 위에 서야 또렷하게 보인다.
  context.fillStyle = CHART.win;
  for (const point of plot.target) {
    context.beginPath();
    context.arc(px(point.x), py(point.y), 4.5, 0, Math.PI * 2);
    context.fill();
  }
  // 명단을 연 회차는 고리를 한 겹 더 두른다. 사이드바의 명단이 그림의 어느 점인지 눈으로 잇는다.
  const selected = plot.target.find((point) => point.attemptId === selectedAttemptId);
  if (selected !== undefined) {
    context.strokeStyle = CHART.win;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(px(selected.x), py(selected.y), 8.5, 0, Math.PI * 2);
    context.stroke();
  }
}
