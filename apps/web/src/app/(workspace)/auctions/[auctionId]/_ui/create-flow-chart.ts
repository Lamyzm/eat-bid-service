/** @module 책임: 설치된 Lightweight Charts의 생성·계열·선택·범위 조작과 해제를 공고 이력 표시 모델과 내 투찰 점에 연결한다. */
import { createChart, LineSeries, HistogramSeries, LineStyle, CrosshairMode, type IPriceLine } from 'lightweight-charts';
import { CHART, chartFrame } from '@/shared/lib/chart-colors';
import { flowObservedRange, type FlowChartModel, type FlowChartPoint, type FlowInspection } from '../_model/flow-chart-model';
import { ownObservedRange, type OwnChartPoint } from '../_model/own-bid-points';
import type { FlowSeriesVisibility } from './flow-legend';
import { OwnPointsSeries, toOwnDayData } from './own-bid/own-bid-series';

type Range = { readonly from: number; readonly to: number };

function unionRange(ranges: readonly (Range | null)[]): Range | null {
  const present = ranges.filter((range): range is Range => range !== null);
  if (!present.length) return null;
  return { from: Math.min(...present.map((range) => range.from)), to: Math.max(...present.map((range) => range.to)) };
}

export function createFlowChart(element: HTMLElement, model: FlowChartModel, onInspect: (items: readonly FlowInspection[], choose: boolean) => void) {
  if (!element.ownerDocument.createElement('canvas').getContext('2d')) throw new Error('캔버스 렌더링을 사용할 수 없습니다.');
  const frame = chartFrame();
  const chart = createChart(element, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: frame.text, fontSize: 13, attributionLogo: true },
    grid: { vertLines: { visible: false }, horzLines: { color: frame.border } },
    rightPriceScale: { borderColor: frame.border, autoScale: false },
    // conflation은 같은 날 여러 제출을 한 점으로 합칠 수 있다. 기본값도 꺼져 있지만 이 차트의 전제라 명시한다.
    timeScale: { borderColor: frame.border, timeVisible: false, rightOffset: 1, minBarSpacing: 0.05, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true, enableConflation: false },
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
  // 실제 제출은 custom series 하나가 그린다. 같은 날의 여러 제출을 LineSeries에 넣으면 첫 값만 남는다.
  const own = chart.addCustomSeries(new OwnPointsSeries(), { color: CHART.own, selectedAttemptId: null, radius: 5, priceLineVisible: false, lastValueVisible: false });
  const selected = chart.addSeries(LineSeries, { ...options, color: CHART.me, lineVisible: false, pointMarkersRadius: 7 });
  const reference = chart.addSeries(LineSeries, { ...options, visible: true, lineVisible: false });
  let mine: IPriceLine | null = null;
  let visibility: FlowSeriesVisibility | undefined;
  let ownPoints: readonly OwnChartPoint[] = [];
  let ownByDay = new Map<number, OwnChartPoint[]>();
  let ownRangeApplied = false;
  const isVisible = (point: FlowChartPoint) => !visibility || (point.row.isSelectedItem ? visibility.win : visibility.otherItems);
  const priceScale = () => chart.priceScale('right');
  // 검사와 사용자가 같은 값을 본다. 캔버스는 DOM에 값을 남기지 않으므로 범위를 attribute로 적어 둔다.
  const publishRange = () => {
    const range = priceScale().getVisibleRange();
    element.dataset.priceRange = range ? `${range.from.toFixed(3)},${range.to.toFixed(3)}` : '';
  };
  const candidatesAt = (time: number): FlowInspection[] => [
    ...(byDay.get(time) ?? []).filter(isVisible).map((point) => ({ kind: 'win' as const, point })),
    ...(visibility?.own === false ? [] : ownByDay.get(time) ?? []).map((point) => ({ kind: 'own' as const, point }))
  ];
  const valuesOf = (item: FlowInspection): number[] => item.kind === 'own'
    ? [item.point.value]
    : [item.point.value, ...(visibility?.runnerUp && item.point.row.secondRateText !== null ? [Number(item.point.row.secondRateText)] : [])];
  const inspect: Parameters<typeof chart.subscribeClick>[0] = (event) => {
    const items = typeof event.time === 'number' ? candidatesAt(event.time) : [];
    if (!event.point || !items.length) return;
    // 같은 날 여러 회차·제출은 가까운 점으로 고르고 값까지 겹치면 후보를 보여 사용자가 선택한다.
    // 좌표 변환은 데이터가 없는 계열에서도 가능하므로 낙찰 점이 없는 캔버스에서도 own 점을 고를 수 있다.
    const distances = items.map((item) => ({
      item,
      distance: Math.min(...valuesOf(item).map((value) => Math.abs((reference.priceToCoordinate(value) ?? Infinity) - event.point!.y)))
    }));
    const nearest = Math.min(...distances.map((entry) => entry.distance));
    if (!Number.isFinite(nearest) || nearest > 12) return;
    const candidates = distances.filter((entry) => entry.distance <= nearest + 1).map((entry) => entry.item);
    onInspect(candidates.length === 1 ? candidates : items, true);
  };
  chart.subscribeClick(inspect);
  // 후보 버튼은 캔버스 밖에 있다. 이탈 즉시 지우면 같은 날짜에 겹친 회차를 버튼으로 선택할 수 없다.
  chart.subscribeCrosshairMove((event) => { if (typeof event.time === 'number') onInspect(candidatesAt(event.time), false); });
  chart.timeScale().fitContent();
  if (model.initialRange) priceScale().setVisibleRange(model.initialRange);
  publishRange();

  // HTML 테마만 관찰해 엔진을 재생성하지 않고 색을 갱신한다. 사용자의 확대 범위·선택·회차 상태는 유지된다.
  const themeObserver = new MutationObserver(() => {
    const nextFrame = chartFrame();
    chart.applyOptions({ layout: { textColor: nextFrame.text }, grid: { horzLines: { color: nextFrame.border } }, rightPriceScale: { borderColor: nextFrame.border }, timeScale: { borderColor: nextFrame.border } });
    for (const { win, second } of wins) {
      win.applyOptions({ color: CHART.win });
      second.applyOptions({ color: CHART.second });
    }
    count?.applyOptions({ color: CHART.volume });
    own.applyOptions({ color: CHART.own });
    selected.applyOptions({ color: CHART.me });
    mine?.applyOptions({ color: CHART.me });
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

  return {
    remove: () => { themeObserver.disconnect(); chart.remove(); },
    reset: () => { chart.timeScale().fitContent(); if (model.initialRange) priceScale().setVisibleRange(model.initialRange); publishRange(); },
    // '전체 값'만 공개 표시 계열과 own을 함께 범위에 넣는다. 응답 도착이 스스로 범위를 바꾸지 않는다.
    fit: () => {
      const range = unionRange([
        flowObservedRange(model.points.filter(isVisible), visibility?.runnerUp ?? false),
        visibility?.own === false ? null : ownObservedRange(ownPoints)
      ]);
      if (range) priceScale().setVisibleRange(range);
      chart.timeScale().fitContent();
      publishRange();
    },
    zoom: (factor: number) => {
      const range = priceScale().getVisibleRange();
      if (!range) return;
      const middle = (range.from + range.to) / 2;
      const half = Math.max(0.002, (range.to - range.from) * factor / 2);
      priceScale().setVisibleRange({ from: Math.max(0, middle - half), to: middle + half });
      publishRange();
    },
    focus: (enabled: boolean) => chart.applyOptions({ handleScale: { mouseWheel: enabled }, handleScroll: { mouseWheel: false } }),
    select: (attemptId: string | undefined) => {
      const point = model.points.find((candidate) => candidate.row.attemptId === attemptId);
      selected.setData(point ? [{ time: point.time, value: point.value }] : []);
      own.applyOptions({ selectedAttemptId: attemptId ?? null });
    },
    update: (visible: FlowSeriesVisibility, myRate: string | null) => {
      visibility = visible;
      for (const { win, second, segment } of wins) {
        const on = segment.points[0]!.row.isSelectedItem ? visible.win : visible.otherItems;
        win.applyOptions({ visible: on });
        second.applyOptions({ visible: on && visible.runnerUp });
      }
      count?.applyOptions({ visible: visible.listCount });
      own.applyOptions({ visible: visible.own });
      if (mine) reference.removePriceLine(mine);
      mine = visible.myRate && myRate !== null ? reference.createPriceLine({ price: Number(myRate), color: CHART.me, lineWidth: 2, lineStyle: LineStyle.Dashed, title: '내 값' }) : null;
    },
    // own 계열만 갈아 끼운다. fitContent·remount 없이 현재 logical/price range를 유지한다. 낙찰 점이 하나도 없어
    // 초기 범위를 못 정한 캔버스에서만 첫 own 도착 때 한 번 own 범위를 놓는다.
    setOwnSubmissions: (points: readonly OwnChartPoint[]) => {
      ownPoints = points;
      ownByDay = new Map();
      for (const point of points) ownByDay.set(point.time, [...ownByDay.get(point.time) ?? [], point]);
      own.setData(toOwnDayData(points));
      if (!ownRangeApplied && model.points.length === 0 && model.initialRange === null) {
        const range = ownObservedRange(points);
        if (range) { priceScale().setVisibleRange(range); ownRangeApplied = true; }
      }
      publishRange();
    }
  };
}

export type FlowChartController = ReturnType<typeof createFlowChart>;
