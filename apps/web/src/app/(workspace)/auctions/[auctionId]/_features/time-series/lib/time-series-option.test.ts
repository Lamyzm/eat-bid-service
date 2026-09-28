import { describe, expect, test } from 'bun:test';
import type { TimeSeriesPlot, TimeSeriesPoint } from '../model/present-time-series';
import { TARGET_SERIES_ID, timeSeriesOption } from './time-series-option';

const domain = { xFrom: 0, xTo: 1_000, yFrom: 88_500, yTo: 91_000 };
const ticks = [89_000, 89_500, 90_000, 90_500, 91_000].map((y) => ({ y, label: String(y) }));

function point(attemptId: string, y: number): TimeSeriesPoint {
  return { x: 100, y, attemptId, revisionId: attemptId, label: `2026-08-04 사정률 ${y}`, dateText: '2026-08-04' };
}

function plot(overrides: Partial<TimeSeriesPlot> = {}): TimeSeriesPlot {
  return {
    domain,
    fullDomain: domain,
    yTicks: ticks,
    fullYTicks: ticks,
    xTicks: [],
    target: [point('11', 89_700), point('12', 90_100)],
    comparison: {
      kind: 'density',
      maxCount: 16,
      cells: [
        { x0: 0, x1: 200, y0: 89_000, y1: 89_100, count: 1, label: '칸 1건' },
        { x0: 0, x1: 200, y0: 89_100, y1: 89_200, count: 16, label: '칸 16건' }
      ]
    },
    floor: { y: 87_745, label: '하한 87.745' },
    outsideTarget: { above: 0, below: 0 },
    outsideComparison: { above: 0, below: 0 },
    truncation: null,
    targetCount: 2,
    comparisonCount: 17,
    overlapCount: 0,
    overlays: [],
    ...overrides
  };
}

type Series = { readonly id: string; readonly data: readonly Record<string, unknown>[]; readonly markLine?: unknown };
const seriesOf = (option: Record<string, unknown>) => option.series as readonly Series[];

describe('시간축 ECharts 설정', () => {
  test('밀도 칸은 가운데의 점 하나가 되고 많이 몰린 칸일수록 크고 진하다', () => {
    const comparison = seriesOf(timeSeriesOption({ plot: plot(), full: false, pinned: null, selectedAttemptId: null }))[0]!;
    const [few, many] = comparison.data as readonly { value: number[]; symbolSize: number; itemStyle: { opacity: number } }[];
    expect(few!.value).toEqual([100, 89_050]);
    expect(many!.symbolSize).toBeGreaterThan(few!.symbolSize);
    expect(many!.itemStyle.opacity).toBeGreaterThan(few!.itemStyle.opacity);
    // 1건짜리 칸도 보여야 한다. 극단값을 눈에서 숨기지 않는다.
    expect(few!.itemStyle.opacity).toBeGreaterThanOrEqual(0.25);
  });

  test('명단을 여는 기관 점 계열은 약속된 id를 갖고 하한이 축 안일 때만 선을 긋는다', () => {
    const inside = seriesOf(timeSeriesOption({ plot: plot({ floor: { y: 89_000, label: '하한 89.000' } }), full: false, pinned: null, selectedAttemptId: null }));
    const target = inside.find((series) => series.id === TARGET_SERIES_ID)!;
    expect(target.data).toHaveLength(2);
    expect(target.markLine).toBeDefined();
    const outside = seriesOf(timeSeriesOption({ plot: plot(), full: false, pinned: null, selectedAttemptId: null }));
    expect(outside.find((series) => series.id === TARGET_SERIES_ID)!.markLine).toBeUndefined();
  });

  test('마우스 올림 정보는 원천이 준 기관명을 HTML로 해석하지 않는다', () => {
    const option = timeSeriesOption({ plot: plot(), full: false, pinned: null, selectedAttemptId: null });
    const formatter = (option.tooltip as { formatter: (params: { name: string }) => string }).formatter;
    expect(formatter({ name: '<img src=x onerror=alert(1)>학교' })).not.toContain('<img');
  });

  test('명단을 연 회차에는 고리를 한 겹 더 두르고 눈금 간격은 표시 모델의 것을 쓴다', () => {
    const option = timeSeriesOption({ plot: plot(), full: false, pinned: null, selectedAttemptId: '12' });
    const selected = seriesOf(option).find((series) => series.id === 'selected')!;
    expect(selected.data[0]!.value).toEqual([100, 90_100]);
    expect((option.yAxis as { interval: number }).interval).toBe(500);
  });
});
