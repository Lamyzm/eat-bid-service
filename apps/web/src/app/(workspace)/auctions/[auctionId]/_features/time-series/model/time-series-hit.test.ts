import { describe, expect, test } from 'bun:test';
import type { TimeSeriesPoint } from './present-time-series';
import { nearestTargetPoint } from './time-series-hit';

const box = { width: 400, height: 200, pad: { left: 0, right: 0, top: 0, bottom: 0 } };
const view = { xFrom: 0, xTo: 400, yFrom: 0, yTo: 200 };

function point(attemptId: string, x: number, y: number): TimeSeriesPoint {
  return { x, y, attemptId, revisionId: `${attemptId}0`, label: '', dateText: '2026-09-01' };
}

describe('시간축 점 집기', () => {
  test('누른 자리에서 반경 안의 가장 가까운 기관 점을 고른다', () => {
    const points = [point('1', 100, 100), point('2', 106, 100)];
    // 캔버스의 y는 아래로 자라므로 사정률 100은 화면 높이 가운데(100px)다.
    expect(nearestTargetPoint(points, view, box, 105, 100)?.attemptId).toBe('2');
  });

  test('반경 밖을 누르면 아무것도 고르지 않는다', () => {
    expect(nearestTargetPoint([point('1', 100, 100)], view, box, 130, 100)).toBeNull();
  });

  test('축 밖이라 그려지지 않은 점은 집지 않는다', () => {
    // 안 보이는 점이 눌리면 사용자는 무엇을 연 것인지 모른다.
    expect(nearestTargetPoint([point('1', 100, 250)], view, box, 100, 0)).toBeNull();
  });
});
