import { describe, expect, test } from 'bun:test';
import type { TimeSeriesPlot } from './present-time-series';
import { floorInside, floorSentence } from './time-series-annotations';

const view = { xFrom: 0, xTo: 1, yFrom: 88_500, yTo: 90_000 };

function plotWithFloor(floor: TimeSeriesPlot['floor']): TimeSeriesPlot {
  return { floor } as TimeSeriesPlot;
}

describe('시간축 그림의 하한 표시', () => {
  test('하한이 축 안이면 선으로 긋고 글은 따로 쓰지 않는다', () => {
    const plot = plotWithFloor({ y: 89_000, label: '하한 89.000' });
    expect(floorInside(plot, view)).toBe(true);
    expect(floorSentence(plot, view)).toBeNull();
  });

  test('하한이 축 밖이면 어느 쪽 밖인지 글로 말한다', () => {
    // 축이 점 덩어리에 맞춰 좁혀졌다고 투찰 판단의 기준선이 말없이 사라지면 안 된다.
    expect(floorSentence(plotWithFloor({ y: 87_500, label: '하한 87.500' }), view)).toBe(
      '하한 87.500 · 아래쪽 범위 밖'
    );
    expect(floorSentence(plotWithFloor({ y: 91_000, label: '하한 91.000' }), view)).toBe(
      '하한 91.000 · 위쪽 범위 밖'
    );
  });

  test('조건에 하한이 없으면 선도 글도 만들지 않는다', () => {
    expect(floorInside(plotWithFloor(null), view)).toBe(false);
    expect(floorSentence(plotWithFloor(null), view)).toBeNull();
  });
});
