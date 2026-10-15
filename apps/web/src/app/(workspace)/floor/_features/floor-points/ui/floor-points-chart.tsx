/** @module 책임: 공고별 하한선 점 그림을 ECharts로 붙이고(확대·이동·누름) 보이는 기간과 누른 공고를 부모에 알린다. */
'use client';
import { CustomChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { init, use as registerEchartsModules, type ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef, useState } from 'react';

import type { FloorData } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { floorPointsOption, HISTOGRAM_SERIES_ID, POINT_SERIES_IDS, type PointsLayers, type PointsPalette } from '../lib/floor-points-option';
import type { HistogramBin } from '../model/points-layers';

// 쓰는 차트·컴포넌트만 등록한다. 전체 번들을 들이지 않는다(ADR 0058 결정 1).
registerEchartsModules([ScatterChart, CustomChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);

const NARROW_WIDTH = 640;

function visibleRange(instance: ECharts): [number, number] | null {
  // 보이는 가로 범위는 공개 API로 값을 주지 않아 축 모델에서 읽는다. 확대 막대의 퍼센트를 시각으로 되돌리는 것보다 정확하다.
  const model = (instance as unknown as { getModel(): { getComponent(type: string, index: number): { axis: { scale: { getExtent(): [number, number] } } } | undefined } }).getModel();
  return model.getComponent('xAxis', 0)?.axis.scale.getExtent() ?? null;
}

/**
 * 그림은 브라우저에서 한 번만 만들고 떼어낼 때 버린다(ADR 0058 결정 5). 층·칸 너비가 바뀌면 계열만 갈아 끼운다 — 통째로
 * 바꾸면 사용자가 확대해 둔 기간이 단추 하나 누를 때마다 풀린다.
 *
 * 그림의 점은 초점을 받을 수 없다. 같은 사실은 그림 아래 문장과 공고 카드가 글로 말한다.
 */
export function FloorPointsChart({
  data,
  layers,
  histogram,
  range,
  initialZoom,
  palette,
  label,
  onRange,
  onPick
}: {
  readonly data: FloorData;
  readonly layers: PointsLayers;
  readonly histogram: readonly HistogramBin[];
  readonly range: { readonly start: number; readonly end: number };
  /** 처음 그릴 때만 쓰는 확대 범위다. 그 뒤로는 사용자가 확대한 범위를 지킨다. */
  readonly initialZoom: readonly [number, number] | null;
  readonly palette: PointsPalette | null;
  readonly label: string;
  readonly onRange: (range: readonly [number, number]) => void;
  readonly onPick: (pointIndex: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<{ readonly instance: ECharts; readonly narrow: boolean } | null>(null);
  const shownHistogram = useRef(histogram);
  const initialZoomRef = useRef(initialZoom);
  /** 전체 설정이 한 번 들어간 뒤에만 막대 계열을 따로 갈아 끼울 수 있다. 그 전에는 계열 종류를 모른다. */
  const drawn = useRef(false);
  // 처리기는 그림을 만든 때가 아니라 그 순간의 입력을 봐야 한다.
  const latest = useRef({ onRange, onPick });
  useEffect(() => {
    latest.current = { onRange, onPick };
  }, [onRange, onPick]);

  // 그림은 칸에 크기가 생긴 뒤에 만든다. 숨은 탭(다른 보기로 연 주소)에서 만들면 폭 0으로 그려진다.
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let created: ECharts | null = null;
    const size = new ResizeObserver(() => {
      if (created !== null) {
        created.resize();
        return;
      }
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      const instance = init(element, null, { renderer: 'canvas' });
      created = instance;
      instance.on('click', (params) => {
        const seriesId = params.seriesId as (typeof POINT_SERIES_IDS)[number] | undefined;
        const value = params.data as readonly number[] | undefined;
        if (seriesId === undefined || !POINT_SERIES_IDS.includes(seriesId) || value === undefined) return;
        // 카드가 그림 아래에 열리면 말풍선은 같은 말을 하며 핵심 구간을 가린다. 닫는다.
        instance.dispatchAction({ type: 'hideTip' });
        latest.current.onPick(value[2]!);
      });
      instance.on('datazoom', () => {
        const extent = visibleRange(instance);
        if (extent !== null) latest.current.onRange(extent);
      });
      setChart({ instance, narrow: element.clientWidth < NARROW_WIDTH });
    });
    size.observe(element);
    return () => {
      size.disconnect();
      created?.dispose();
      drawn.current = false;
      setChart(null);
    };
  }, []);

  // 칸별 건수는 확대할 때마다 바뀐다. 막대 계열만 갈아 끼운다 — 전체 설정을 다시 넣으면 점 수천 개를 매번 다시 그린다.
  useEffect(() => {
    shownHistogram.current = histogram;
    if (drawn.current) chart?.instance.setOption({ series: [{ id: HISTOGRAM_SERIES_ID, data: histogram }] });
  }, [chart, histogram]);

  useEffect(() => {
    if (palette === null || chart === null) return;
    const zoom = drawn.current ? null : initialZoomRef.current;
    const option = floorPointsOption({ data, layers, histogram: shownHistogram.current, range, palette, narrow: chart.narrow, zoom });
    chart.instance.setOption(option, { replaceMerge: ['series'] });
    drawn.current = true;
  }, [chart, data, layers, range, palette]);

  return <div ref={host} role='img' aria-label={label} className='h-[480px] w-full sm:h-[560px]' />;
}
