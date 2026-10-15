/**
 * @module 책임: 공고별 하한선 점·층·칸별 건수 막대를 ECharts 설정 하나로 옮긴다(좌표·색·확대·마우스 올림 글).
 *
 * 무엇을 그릴지는 표시 모델이 이미 정했다. 여기서는 ECharts의 말로 옮기기만 하고 다시 셈하지 않는다(ADR 0058 결정 3).
 * 색은 호출자가 넘긴다 — 캔버스는 CSS 변수를 못 읽어 테마가 바뀔 때마다 그 순간의 색으로 다시 만들어야 해서다.
 */
import type { CustomSeriesRenderItemAPI, CustomSeriesRenderItemReturn, EChartsCoreOption } from 'echarts';
import { format, time } from 'echarts/core';

import { assessmentRate, organizationLabel, per100MillionText, rateText } from '@/entities/floor-line/floor-units';
import type { FloorData } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { AXIS_HIGH, AXIS_LOW, type BandRect, type HistogramBin, type LayerDot, type MineDots } from '../model/points-layers';

export interface PointsPalette {
  readonly point: string;
  readonly ladder: string;
  readonly mine: string;
  readonly text: string;
  readonly border: string;
  /** 마우스 올림 글 상자의 바탕·글자색이다. 글 상자는 HTML이라 테마 토큰의 계산값을 그대로 쓴다. */
  readonly surface: string;
  readonly ink: string;
}

export interface PointsLayers {
  readonly bands: readonly BandRect[];
  readonly ladders: readonly LayerDot[];
  readonly mine: MineDots;
}

/** 점을 누르면 공고 카드를 여는 계열이다. 클릭 처리기가 이 id로 공고를 찾는다. */
export const POINT_SERIES_IDS = ['floor', 'mine', 'below', 'won'] as const;
export const HISTOGRAM_SERIES_ID = 'histogram';

/** 달 띠다. 위·아래 선을 진하게 그어 칸의 경계가 점에 묻히지 않게 하고, 폭이 넉넉할 때만 사정률 범위를 적는다. */
function bandItem(palette: PointsPalette) {
  return (_params: unknown, api: CustomSeriesRenderItemAPI): CustomSeriesRenderItemReturn => {
    const topLeft = api.coord([api.value(0), api.value(3)]);
    const bottomRight = api.coord([api.value(1), api.value(2)]);
    const x = topLeft[0]!;
    const y = topLeft[1]!;
    const width = bottomRight[0]! - x;
    const height = bottomRight[1]! - y;
    const range = `${rateText(Number(api.value(2)), 1)}~${rateText(Number(api.value(3)), 1)}`;
    return {
      type: 'group',
      children: [
        { type: 'rect', shape: { x: x + 1, y, width: Math.max(1, width - 2), height }, style: { fill: palette.point, opacity: 0.16 } },
        { type: 'line', shape: { x1: x + 1, y1: y, x2: x + width - 1, y2: y }, style: { stroke: palette.point, lineWidth: 2, opacity: 0.9 } },
        { type: 'line', shape: { x1: x + 1, y1: y + height, x2: x + width - 1, y2: y + height }, style: { stroke: palette.point, lineWidth: 2, opacity: 0.9 } },
        ...(width > 84
          ? [{ type: 'text' as const, x: x + 4, y: y - 4, style: { text: range, fill: palette.text, font: '600 11px sans-serif', verticalAlign: 'bottom' as const } }]
          : [])
      ]
    };
  };
}

function histogramItem(palette: PointsPalette) {
  return (_params: unknown, api: CustomSeriesRenderItemAPI): CustomSeriesRenderItemReturn => {
    const count = Number(api.value(2));
    if (count === 0) return null;
    const topLeft = api.coord([0, api.value(1)]);
    const bottomRight = api.coord([count, api.value(0)]);
    return {
      type: 'rect',
      shape: { x: topLeft[0]!, y: topLeft[1]! + 0.5, width: Math.max(1, bottomRight[0]! - topLeft[0]!), height: Math.max(1, bottomRight[1]! - topLeft[1]! - 1) },
      style: { fill: palette.point }
    };
  };
}

function outcomeText(bid: Extract<FloorData['mine'], { kind: 'bids' }>['bids'][number]): string {
  if (bid.outcome.kind === 'below-floor') return '하한 미달';
  if (bid.outcome.won) return '이 값으로 낙찰';
  return `하한 위 ${bid.outcome.validBidderCount}곳 중 ${bid.outcome.rank}등`;
}

/** 마우스 올림 글이다. 기관 이름은 원본 라벨이라 HTML로 해석되지 않게 감싼다. */
function tooltipText(data: FloorData) {
  const bids = data.mine.kind === 'bids' ? data.mine.bids : [];
  return (params: unknown): string => {
    const item = params as { seriesId?: string; data?: readonly number[] };
    if (item.data === undefined) return '';
    const point = data.points[item.data[2]!];
    if (point === undefined) return '';
    const name = format.encodeHTML(organizationLabel(data.organizations, point.organization));
    if (item.seriesId === 'floor') {
      const mine = bids
        .filter((bid) => bid.attemptId === point.attemptId)
        .map((bid) => `<br>${format.encodeHTML(bid.supplier)} 사정률 ${rateText(bid.rate, 3)} · ${outcomeText(bid)}`)
        .join('');
      return `<b>${name}</b><br><span style="opacity:.75">${point.opened}</span><br>하한선 사정률 <b>${rateText(point.floor, 3)}</b> · 기초금액의 ${point.floor.toFixed(2)}% · 1억이면 ${per100MillionText(point.floor)}${mine}`;
    }
    const bid = bids[item.data[3]!];
    if (bid === undefined) return '';
    return `<b>${name}</b><br>${format.encodeHTML(bid.supplier)} 사정률 ${rateText(bid.rate, 3)} · ${outcomeText(bid)}`;
  };
}

export interface PointsOptionInput {
  readonly data: FloorData;
  readonly layers: PointsLayers;
  readonly histogram: readonly HistogramBin[];
  readonly range: { readonly start: number; readonly end: number };
  readonly palette: PointsPalette;
  /** 그림 칸 폭이 640px 아래다. 오른쪽 막대 몫을 늘리고 마우스 올림 글을 끈다(손가락은 눌러서 카드를 연다). */
  readonly narrow: boolean;
  /** 처음 그릴 때만 넣는 가로 확대 범위다. 다시 넣을 때 빼야 사용자가 확대해 둔 기간이 풀리지 않는다. */
  readonly zoom?: readonly [number, number] | null;
}

export function floorPointsOption({ data, layers, histogram, range, palette, narrow, zoom = null }: PointsOptionInput): EChartsCoreOption {
  const xZoom = zoom === null ? {} : { startValue: zoom[0], endValue: zoom[1] };
  const axisText = { color: palette.text, fontSize: 11 };
  const zoomFill = 'rgba(120,140,170,0.18)';
  return {
    animation: false,
    grid: [
      { left: 92, right: narrow ? '24%' : '18%', top: 16, bottom: 74 },
      { right: 8, width: narrow ? '20%' : '15%', top: 16, bottom: 74 }
    ],
    xAxis: [
      {
        type: 'time',
        gridIndex: 0,
        min: range.start,
        max: range.end,
        axisLine: { lineStyle: { color: palette.border } },
        axisLabel: { ...axisText, fontSize: 12, hideOverlap: true, formatter: { year: '{yyyy}년', month: '{M}월', day: '{M}.{d}', hour: '{HH}:{mm}' } },
        splitLine: { show: false }
      },
      {
        type: 'value',
        gridIndex: 1,
        name: '공고 수',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: axisText,
        splitNumber: narrow ? 2 : 4,
        minInterval: 1,
        axisLabel: { ...axisText, fontSize: narrow ? 10 : 11 },
        splitLine: { lineStyle: { color: palette.border } }
      }
    ],
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        min: AXIS_LOW,
        max: AXIS_HIGH,
        interval: 0.5,
        axisLabel: { ...axisText, lineHeight: 13, formatter: (value: number) => `사정률 ${assessmentRate(value).toFixed(1)}\n(${value.toFixed(1)}%)` },
        splitLine: { lineStyle: { color: palette.border } }
      },
      { type: 'value', gridIndex: 1, min: AXIS_LOW, max: AXIS_HIGH, show: false }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none', ...xZoom },
      { type: 'inside', yAxisIndex: [0, 1], filterMode: 'none', zoomOnMouseWheel: 'shift', moveOnMouseWheel: false },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        ...xZoom,
        bottom: 12,
        height: 30,
        // 막대 안 미리보기 선은 첫 계열(달 띠·1~10등)을 그려 하한선과 다른 모양을 보인다. 끈다.
        showDataShadow: false,
        borderColor: palette.border,
        fillerColor: zoomFill,
        textStyle: { color: palette.text },
        labelFormatter: (value: number) => time.format(value, '{yyyy}.{M}', false)
      },
      { type: 'slider', yAxisIndex: [0, 1], filterMode: 'none', left: 4, width: 14, borderColor: palette.border, showDetail: false, fillerColor: zoomFill }
    ],
    tooltip: {
      show: !narrow,
      trigger: 'item',
      confine: true,
      backgroundColor: palette.surface,
      borderColor: palette.border,
      textStyle: { fontSize: 13, color: palette.ink },
      formatter: tooltipText(data)
    },
    series: [
      { id: 'band', type: 'custom', xAxisIndex: 0, yAxisIndex: 0, data: layers.bands, encode: { x: [0, 1], y: [2, 3] }, clip: true, silent: true, z: 0, renderItem: bandItem(palette) },
      { id: 'ladder', type: 'scatter', data: layers.ladders, symbolSize: 4, large: true, largeThreshold: 2000, progressive: 0, itemStyle: { color: palette.ladder, opacity: 0.55 }, silent: true, z: 1 },
      { id: 'floor', type: 'scatter', data: data.points.map((point, index) => [point.t, point.floor, index]), symbolSize: 5, progressive: 0, itemStyle: { color: palette.point, opacity: 0.8 }, z: 3 },
      { id: 'mine', type: 'scatter', data: layers.mine.valid, symbolSize: 6, progressive: 0, itemStyle: { color: palette.mine, opacity: 0.5 }, z: 4 },
      { id: 'below', type: 'scatter', data: layers.mine.below, symbolSize: 7, progressive: 0, itemStyle: { color: 'transparent', borderColor: palette.mine, borderWidth: 1.5 }, z: 4 },
      { id: 'won', type: 'scatter', data: layers.mine.won, symbolSize: 12, progressive: 0, itemStyle: { color: 'transparent', borderColor: palette.mine, borderWidth: 3 }, z: 5 },
      { id: HISTOGRAM_SERIES_ID, type: 'custom', xAxisIndex: 1, yAxisIndex: 1, data: histogram, encode: { x: 2, y: [0, 1] }, clip: true, silent: true, renderItem: histogramItem(palette) }
    ]
  };
}
