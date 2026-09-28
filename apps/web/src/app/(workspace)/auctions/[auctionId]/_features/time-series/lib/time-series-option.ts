/**
 * @module 책임: 시간축 표시 모델을 ECharts 설정 하나로 옮긴다(좌표·색·확대·마우스 올림 정보).
 *
 * 무엇을 그릴지는 표시 모델(`present-time-series`)이 이미 정했다. 여기는 그 결정을 ECharts의 말로 옮길 뿐이고,
 * 축 범위·눈금 간격·하한·잘림을 다시 계산하지 않는다(ADR 0058 결정 3). React를 모르는 순수 함수라 설정을
 * 테스트로 바로 확인할 수 있다.
 */
import { format, type EChartsCoreOption } from 'echarts/core';

import { rateText } from '@/app/(workspace)/auctions/[auctionId]/_lib/rate-milli';
import { CHART, chartFrame } from '@/shared/lib/chart-colors';

import type { TimeSeriesPlot, TimeSeriesPoint } from '../model/present-time-series';
import { floorInside } from '../model/time-series-annotations';
import { rateTickDecimals } from '../model/time-series-axis';

export interface TimeSeriesOptionInput {
  readonly plot: TimeSeriesPlot;
  /** `전체 값 보기`다. 세로축만 넓힌다. */
  readonly full: boolean;
  /** 집어 둔 겹친 기관이다. 그것만 진하게 그린다. */
  readonly pinned: string | null;
  /** 명단을 연 회차다. 고리를 한 겹 더 두른다. */
  readonly selectedAttemptId: string | null;
  /** 손가락 입력 기기다. 아래 기간 막대를 두지 않는다(아래 dataZoom 주석). */
  readonly coarsePointer?: boolean;
}

/** 점을 누르면 명단을 여는 계열의 id다. 클릭 이벤트가 이 id로 기관 점만 가려낸다. */
export const TARGET_SERIES_ID = 'target';

/** 밀도 점의 반지름을 지름으로 옮긴다. 진하기와 같은 제곱근 척도라 많이 몰린 자리가 크기로도 읽힌다. */
function cellSize(count: number, maxCount: number): number {
  return 2 * (1.75 + 2.25 * Math.sqrt(count / maxCount));
}

/** 1건짜리 칸도 보이게 최소 진하기를 준다. 비율 그대로 쓰면 극단값이 눈에서 사라진다. */
function cellOpacity(count: number, maxCount: number): number {
  return 0.25 + 0.75 * Math.sqrt(count / maxCount);
}

function pointData(points: readonly TimeSeriesPoint[], suffix = '') {
  return points.map((point) => ({ value: [point.x, point.y], name: `${point.label}${suffix}` }));
}

export function timeSeriesOption({
  plot,
  full,
  pinned,
  selectedAttemptId,
  coarsePointer = false
}: TimeSeriesOptionInput): EChartsCoreOption {
  const view = full ? plot.fullDomain : plot.domain;
  const ticks = full ? plot.fullYTicks : plot.yTicks;
  // 눈금 간격은 표시 모델이 고른 값을 그대로 쓴다. ECharts가 스스로 고르면 87.3·88.1 같은 눈금이 선다.
  const step = ticks.length > 1 ? ticks[1]!.y - ticks[0]!.y : undefined;
  const decimals = step === undefined ? 3 : rateTickDecimals(step);
  const frame = chartFrame();
  const selected = plot.target.find((point) => point.attemptId === selectedAttemptId);

  const comparison =
    plot.comparison.kind === 'density'
      ? {
          id: 'comparison',
          type: 'scatter',
          // 칸 하나를 그 가운데의 점 하나로 그린다. 면으로 채우면 0.1%p 높이라 가로 막대가 된다(EAT-224).
          data: plot.comparison.cells.map((cell) => {
            const { maxCount } = plot.comparison as { readonly maxCount: number };
            return {
              value: [(cell.x0 + cell.x1) / 2, (cell.y0 + cell.y1) / 2],
              name: cell.label,
              symbolSize: cellSize(cell.count, maxCount),
              itemStyle: { opacity: cellOpacity(cell.count, maxCount) }
            };
          }),
          itemStyle: { color: CHART.volume },
          z: 1
        }
      : {
          id: 'comparison',
          type: 'scatter',
          data: pointData(plot.comparison.points),
          symbolSize: 7,
          itemStyle: { color: 'transparent', borderColor: CHART.volume, borderWidth: 1.25 },
          z: 1
        };

  // 겹친 기관은 고리로 그린다. 하나를 집으면 그것만 진해지고 나머지는 자리만 남긴다.
  const overlays = plot.overlays.map((series) => {
    const focused = pinned === null || pinned === series.organizationId;
    return {
      id: `overlay-${series.organizationId}`,
      type: 'scatter',
      data: pointData(series.points, ` · ${series.index}. ${series.label}`),
      symbolSize: 10,
      itemStyle: {
        color: 'transparent',
        borderColor: CHART.second,
        borderWidth: focused ? 1.75 : 1,
        opacity: focused ? 0.95 : 0.25
      },
      z: 2
    };
  });

  const target = {
    id: TARGET_SERIES_ID,
    type: 'scatter',
    data: pointData(plot.target),
    symbolSize: 9,
    itemStyle: { color: CHART.win },
    cursor: 'pointer',
    z: 4,
    // 하한은 축 범위 안일 때만 선을 긋는다. 밖이면 그림 아래 문장이 어느 쪽 밖인지 말한다.
    markLine: floorInside(plot, view)
      ? {
          silent: true,
          symbol: 'none',
          lineStyle: { color: CHART.floor, type: 'dashed', width: 1.25 },
          label: { formatter: plot.floor!.label, color: CHART.floor, position: 'insideEndTop' },
          data: [{ yAxis: plot.floor!.y }]
        }
      : undefined
  };

  const selection =
    selected === undefined
      ? []
      : [
          {
            id: 'selected',
            type: 'scatter',
            data: [{ value: [selected.x, selected.y], name: selected.label }],
            symbolSize: 17,
            itemStyle: { color: 'transparent', borderColor: CHART.win, borderWidth: 2 },
            silent: true,
            z: 5
          }
        ];

  return {
    animation: false,
    // 막대가 없으면 그 자리만큼 아래 여백을 줄인다.
    grid: { left: 56, right: 16, top: 28, bottom: coarsePointer ? 28 : 64 },
    textStyle: { color: frame.text, fontSize: 11 },
    xAxis: {
      type: 'time',
      min: view.xFrom,
      max: view.xTo,
      axisLine: { lineStyle: { color: frame.border } },
      axisLabel: {
        color: frame.text,
        hideOverlap: true,
        formatter: { year: '{yyyy}', month: '{M}월', day: '{M}.{d}' }
      },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      min: view.yFrom,
      max: view.yTo,
      interval: step,
      name: '사정률(%)',
      nameTextStyle: { color: frame.text, align: 'left' },
      axisLabel: {
        color: frame.text,
        // 값은 milli 정수다. 간격이 말하는 자릿수까지만 쓴다(88.5 또는 88.50).
        formatter: (value: number) => {
          const text = rateText(Math.round(value));
          return text.slice(0, text.length - (3 - decimals));
        }
      },
      splitLine: { lineStyle: { color: frame.border } }
    },
    tooltip: {
      trigger: 'item',
      confine: true,
      // 이름에는 원천이 준 기관명이 섞인다. HTML로 그려지므로 반드시 escape한다.
      formatter: (params: { readonly name: string }) => format.encodeHTML(params.name)
    },
    toolbox: {
      right: 8,
      top: 0,
      itemSize: 13,
      // `restore`는 두지 않는다. 처음 그린 설정으로 되돌려 그 뒤의 전체 값 보기·선택 고리까지 풀기 때문이다.
      // 기간 확대만 푸는 `전체 기간` 버튼은 그림 아래에 따로 있다.
      feature: {
        dataZoom: { yAxisIndex: 'none', title: { zoom: '끌어서 기간 확대', back: '확대 한 단계 되돌리기' } }
      }
    },
    // 휠로 확대하고 끌어 옮기며, 아래 막대로 기간을 고른다. 걸러 내지 않아야(filterMode none) 확대해도
    // 표본 수와 밀도 점이 사라지지 않는다.
    //
    // 손가락 기기에는 아래 막대를 두지 않는다. 막대가 있으면 그림 위 어디를 세로로 쓸어도 페이지가 내려가지
    // 않았다(2026-09-28 iPhone 13 에뮬레이션, 부품을 하나씩 켠 실측: 막대만 0px, 나머지는 185px). 그림 안
    // 확대·끌기는 세로 쓸기를 막지 않아 두 손가락 확대와 가로 끌기는 그대로 둔다.
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseWheel: false },
      ...(coarsePointer
        ? []
        : [
            {
              type: 'slider',
              xAxisIndex: 0,
              filterMode: 'none',
              height: 18,
              bottom: 12,
              labelFormatter: '',
              showDataShadow: false
            }
          ])
    ],
    series: [comparison, ...overlays, target, ...selection]
  };
}
