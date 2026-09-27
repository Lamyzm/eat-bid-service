/**
 * @module 책임: 시간축 그림에서 선으로 그리지 못한 사실(축 밖 관측 수, 축 밖 하한)을 사용자가 읽을 문장으로 만든다.
 *
 * 그리기에서 떼어 낸 이유는 바뀌는 이유가 다르기 때문이다. 이쪽은 "무엇을 말로 남길 것인가"의 규칙이고,
 * 캔버스 쪽은 좌표와 색이다.
 */
import type { TimeSeriesDomain, TimeSeriesPlot } from './present-time-series';

/**
 * 축 밖으로 나간 관측을 문장으로 말한다. 기본 축은 가운데 덩어리에 맞춰 잘리므로 "안 보이는 점이
 * 있다"는 사실을 화면이 직접 말하지 않으면 사용자는 그 점이 없는 줄 안다 — 그러면 우리가 관측을
 * 숨긴 것이 된다. 전체 값 보기에서는 남는 것이 없으므로 아무 문장도 만들지 않는다.
 */
export function outsideSentences(
  plot: TimeSeriesPlot,
  organizationLabel: string,
  comparisonLabel: string,
  full: boolean
): readonly string[] {
  if (full) return [];
  const sentence = (title: string, target: number, comparison: number) => {
    const parts = [
      target === 0 ? null : `${organizationLabel} ${target}건`,
      comparison === 0 ? null : `${comparisonLabel} ${comparison}건`
    ].filter((part) => part !== null);
    return parts.length === 0 ? null : `${title} ${parts.join(' · ')}`;
  };
  return [
    sentence('위쪽 범위 밖', plot.outsideTarget.above, plot.outsideComparison.above),
    sentence('아래쪽 범위 밖', plot.outsideTarget.below, plot.outsideComparison.below)
  ].filter((line) => line !== null);
}

export function floorInside(plot: TimeSeriesPlot, view: TimeSeriesDomain): boolean {
  return plot.floor !== null && plot.floor.y >= view.yFrom && plot.floor.y <= view.yTo;
}

/**
 * 하한이 축 밖이면 선 대신 글로 말한다. 하한은 투찰 판단의 기준선이라, 축이 점 덩어리에 맞춰 좁혀졌다는
 * 이유로 말없이 사라지면 사용자는 점들이 하한에서 얼마나 떨어졌는지 모른 채 읽는다.
 */
export function floorSentence(plot: TimeSeriesPlot, view: TimeSeriesDomain): string | null {
  if (plot.floor === null || floorInside(plot, view)) return null;
  return plot.floor.y < view.yFrom
    ? `${plot.floor.label} · 아래쪽 범위 밖`
    : `${plot.floor.label} · 위쪽 범위 밖`;
}
