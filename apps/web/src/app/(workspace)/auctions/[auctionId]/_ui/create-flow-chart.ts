/** @module 책임: 설치된 Lightweight Charts의 생성·계열·선택·범위 조작과 해제를 공고 이력 표시 모델에 연결한다. */
import { createChart, LineSeries, HistogramSeries, LineStyle, CrosshairMode, type IPriceLine } from 'lightweight-charts';
import { CHART, chartFrame } from '@/shared/lib/chart-colors';
import { flowObservedRange, type FlowChartModel, type FlowChartPoint } from '../_model/flow-chart-model';
import type { FlowSeriesVisibility } from './flow-legend';

export function createFlowChart(element: HTMLElement, model: FlowChartModel, onInspect: (points: readonly FlowChartPoint[], choose: boolean) => void) {
  if (!element.ownerDocument.createElement('canvas').getContext('2d')) throw new Error('캔버스 렌더링을 사용할 수 없습니다.');
  const frame = chartFrame();
  const chart = createChart(element, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: frame.text, fontSize: 13, attributionLogo: true },
    grid: { vertLines: { visible: false }, horzLines: { color: frame.border } },
    rightPriceScale: { borderColor: frame.border, autoScale: false },
    timeScale: { borderColor: frame.border, timeVisible: false, rightOffset: 1, minBarSpacing: 0.05, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true },
    localization: { locale: 'ko-KR', dateFormat: 'yyyy-MM-dd', priceFormatter: (value: number) => value.toFixed(3) },
    crosshair: { mode: CrosshairMode.Normal },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true }
  });
  const options = { priceLineVisible: false, lastValueVisible: false, pointMarkersVisible: true, pointMarkersRadius: 4, priceFormat: { type: 'price' as const, precision: 3, minMove: 0.001 } };
  // 빈 날짜를 공통 축에 남긴다. 표본을 추가하는 계열이 아니라 시간 간격만 유지하는 whitespace다.
  const calendar = chart.addSeries(LineSeries, { ...options, visible: false });
  calendar.setData([...model.calendar]);
  const wins = model.series.map((segment) => {
    const win = chart.addSeries(LineSeries, { ...options, color: CHART.win, lineWidth: 2, lineVisible: segment.connected });
    win.setData(segment.points.map(({ time, value }) => ({ time, value })));
    const second = chart.addSeries(LineSeries, { ...options, color: CHART.second, lineWidth: 1, lineStyle: LineStyle.Dashed, lineVisible: segment.connected, visible: false, pointMarkersRadius: 3 });
    second.setData(segment.points.map(({ time, row }) => row.secondRateText === null ? { time } : { time, value: Number(row.secondRateText) }));
    return { win, second, segment };
  });
  const byDay = new Map<number, FlowChartPoint[]>();
  for (const point of model.points) byDay.set(point.time, [...byDay.get(point.time) ?? [], point]);
  // 같은 날 여러 회차의 명단을 합쳐 한 회차 수처럼 보이지 않게 한다. 각각의 수는 선택 목록과 표에서 읽는다.
  const countData = [...byDay.values()].map((points) => points.length === 1 && points[0]!.row.listCount !== null
    ? { time: points[0]!.time, value: points[0]!.row.listCount! }
    : { time: points[0]!.time });
  const count = countData.some((point) => 'value' in point)
    ? chart.addSeries(HistogramSeries, { color: CHART.volume, priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1)
    : null;
  count?.setData(countData);
  chart.panes()[0]?.setStretchFactor(5);
  chart.panes()[1]?.setStretchFactor(1);
  const selected = chart.addSeries(LineSeries, { ...options, color: CHART.me, lineVisible: false, pointMarkersRadius: 7 });
  const reference = chart.addSeries(LineSeries, { ...options, visible: true, lineVisible: false });
  let mine: IPriceLine | null = null;
  let visibility: FlowSeriesVisibility;
  const isVisible = (point: FlowChartPoint) => !visibility || (point.row.isSelectedItem ? visibility.win : visibility.otherItems);
  const inspect: Parameters<typeof chart.subscribeClick>[0] = (event) => {
    const points = typeof event.time === 'number' ? (byDay.get(event.time) ?? []).filter(isVisible) : [];
    if (!event.point || !points.length) return;
    // 같은 날 여러 회차는 가까운 점으로 고르고 값까지 겹치면 후보를 보여 사용자가 선택한다.
    const distances = points.map((point) => {
      const values = [point.value, ...(visibility?.runnerUp && point.row.secondRateText !== null ? [Number(point.row.secondRateText)] : [])];
      return { point, distance: Math.min(...values.map((value) => Math.abs((wins[0]?.win.priceToCoordinate(value) ?? Infinity) - event.point!.y))) };
    });
    const nearest = Math.min(...distances.map((item) => item.distance));
    if (!Number.isFinite(nearest) || nearest > 12) return;
    const candidates = distances.filter((item) => item.distance <= nearest + 1).map((item) => item.point);
    onInspect(candidates.length === 1 ? candidates : points, true);
  };
  chart.subscribeClick(inspect);
  // 후보 버튼은 캔버스 밖에 있다. 이탈 즉시 지우면 같은 날짜에 겹친 회차를 버튼으로 선택할 수 없다.
  chart.subscribeCrosshairMove((event) => { if (typeof event.time === 'number') onInspect((byDay.get(event.time) ?? []).filter(isVisible), false); });
  chart.timeScale().fitContent();
  if (model.initialRange) chart.priceScale('right').setVisibleRange(model.initialRange);

  // HTML 테마만 관찰해 엔진을 재생성하지 않고 색을 갱신한다. 사용자의 확대 범위·선택·회차 상태는 유지된다.
  const themeObserver = new MutationObserver(() => {
    const nextFrame = chartFrame();
    chart.applyOptions({ layout: { textColor: nextFrame.text }, grid: { horzLines: { color: nextFrame.border } }, rightPriceScale: { borderColor: nextFrame.border }, timeScale: { borderColor: nextFrame.border } });
    for (const { win, second } of wins) {
      win.applyOptions({ color: CHART.win });
      second.applyOptions({ color: CHART.second });
    }
    count?.applyOptions({ color: CHART.volume });
    selected.applyOptions({ color: CHART.me });
    mine?.applyOptions({ color: CHART.me });
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

  return {
    remove: () => { themeObserver.disconnect(); chart.remove(); },
    reset: () => { chart.timeScale().fitContent(); if (model.initialRange) chart.priceScale('right').setVisibleRange(model.initialRange); },
    fit: () => { const range = flowObservedRange(model.points.filter(isVisible), visibility?.runnerUp ?? false); if (range) chart.priceScale('right').setVisibleRange(range); chart.timeScale().fitContent(); },
    zoom: (factor: number) => {
      const range = chart.priceScale('right').getVisibleRange();
      if (!range) return;
      const middle = (range.from + range.to) / 2;
      const half = Math.max(0.002, (range.to - range.from) * factor / 2);
      chart.priceScale('right').setVisibleRange({ from: Math.max(0, middle - half), to: middle + half });
    },
    focus: (enabled: boolean) => chart.applyOptions({ handleScale: { mouseWheel: enabled }, handleScroll: { mouseWheel: false } }),
    select: (attemptId: string | undefined) => {
      const point = model.points.find((candidate) => candidate.row.attemptId === attemptId);
      selected.setData(point ? [{ time: point.time, value: point.value }] : []);
    },
    update: (visible: FlowSeriesVisibility, myRate: string | null) => {
      visibility = visible;
      for (const { win, second, segment } of wins) {
        const on = segment.points[0]!.row.isSelectedItem ? visible.win : visible.otherItems;
        win.applyOptions({ visible: on });
        second.applyOptions({ visible: on && visible.runnerUp });
      }
      count?.applyOptions({ visible: visible.listCount });
      if (mine) reference.removePriceLine(mine);
      mine = visible.myRate && myRate !== null ? reference.createPriceLine({ price: Number(myRate), color: CHART.me, lineWidth: 2, lineStyle: LineStyle.Dashed, title: '내 값' }) : null;
    }
  };
}

export type FlowChartController = ReturnType<typeof createFlowChart>;
