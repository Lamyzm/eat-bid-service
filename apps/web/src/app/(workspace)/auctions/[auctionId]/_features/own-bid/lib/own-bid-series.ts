/** @module 책임: 같은 날 여러 제출을 한 시간 좌표에 각각 그리는 Lightweight Charts custom series를 소유한다. 일반 LineSeries는 같은 time 중복을 버리므로 own 점은 여기서만 그린다. */
import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesPricePlotValues,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
  type UTCTimestamp
} from 'lightweight-charts';

import type { OwnChartPoint } from '../model/own-bid-points';

/** 날짜별 unique time 한 행에 그날의 제출 전부를 담는다. 가짜 초·jitter·평균을 넣지 않는다. */
export type OwnDayDatum = CustomData<Time> & {
  readonly time: UTCTimestamp;
  readonly submissions: readonly OwnChartPoint[];
};

export type OwnSeriesOptions = CustomSeriesOptions & {
  /** 선택한 회차의 점만 굵게 그린다. 선택은 controller가 소유하고 이 계열은 표시만 한다. */
  readonly selectedAttemptId: string | null;
  readonly radius: number;
};

// fancy-canvas 타입을 직접 import하지 않는다. 설치본 renderer 계약에서 파생해야 라이브러리 버전과 어긋나지 않는다.
type DrawTarget = Parameters<ICustomSeriesPaneRenderer['draw']>[0];

export function toOwnDayData(points: readonly OwnChartPoint[]): OwnDayDatum[] {
  const byDay = new Map<number, OwnChartPoint[]>();
  for (const point of points) byDay.set(point.time, [...(byDay.get(point.time) ?? []), point]);
  return [...byDay.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([time, submissions]) => ({ time: time as UTCTimestamp, submissions }));
}

class OwnPointsRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, OwnDayDatum> | null = null;
  private options: OwnSeriesOptions | null = null;

  update(data: PaneRendererCustomData<Time, OwnDayDatum>, options: OwnSeriesOptions): void {
    this.data = data;
    this.options = options;
  }

  draw(target: DrawTarget, priceConverter: PriceToCoordinateConverter): void {
    const { data, options } = this;
    if (!data || !options || !data.visibleRange) return;
    const range = data.visibleRange;
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      for (let index = range.from; index < range.to; index += 1) {
        const bar = data.bars[index];
        if (!bar) continue;
        for (const submission of bar.originalData.submissions) {
          const y = priceConverter(submission.value);
          if (y === null) continue;
          const selected = options.selectedAttemptId === submission.row.attemptId;
          const radius = (selected ? options.radius + 2 : options.radius) * horizontalPixelRatio;
          const x = bar.x * horizontalPixelRatio;
          const cy = y * verticalPixelRatio;
          // 마름모. 낙찰 점(원)과 표식이 달라야 같은 자리에 겹쳐도 두 사실로 읽힌다.
          context.beginPath();
          context.moveTo(x, cy - radius);
          context.lineTo(x + radius, cy);
          context.lineTo(x, cy + radius);
          context.lineTo(x - radius, cy);
          context.closePath();
          context.fillStyle = options.color;
          context.fill();
          context.lineWidth = 1.5 * horizontalPixelRatio;
          context.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.85)';
          context.stroke();
        }
      }
    });
  }
}

export class OwnPointsSeries implements ICustomSeriesPaneView<Time, OwnDayDatum, OwnSeriesOptions> {
  private readonly paneRenderer = new OwnPointsRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this.paneRenderer;
  }

  update(data: PaneRendererCustomData<Time, OwnDayDatum>, options: OwnSeriesOptions): void {
    this.paneRenderer.update(data, options);
  }

  // 자동 범위·crosshair가 읽는 값이다. 그날의 최소·최대·마지막 값을 주면 점 전부가 범위 계산에 든다.
  priceValueBuilder(row: OwnDayDatum): CustomSeriesPricePlotValues {
    const values = row.submissions.map((submission) => submission.value);
    return [Math.min(...values), Math.max(...values), values[values.length - 1]!];
  }

  isWhitespace(data: OwnDayDatum | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return !('submissions' in data) || data.submissions.length === 0;
  }

  defaultOptions(): OwnSeriesOptions {
    return {
      ...customSeriesDefaultOptions,
      color: '#b31cbf',
      selectedAttemptId: null,
      // 낙찰 점(반지름 4)보다 한 단계 크게 둔다. 같은 값에 겹쳐도 마름모가 원 밖으로 드러나야 두 사실로 읽힌다.
      radius: 6,
      priceLineVisible: false,
      lastValueVisible: false
    };
  }
}
