import { describe, expect, test } from 'bun:test';

import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from '../_model/attempt-history';
import { BAR_BOTTOM, BAR_TOP, LIST_BAR_CAP, flowPoints, listBars, monthLabels, myRatePlacement } from './flow-geometry';

const rows = presentHistory(attemptsFixture, '7').rows;

describe('흐름 차트 좌표', () => {
  test('점은 오래된 회차가 왼쪽에 오도록 시간순이고 달 라벨을 함께 든다', () => {
    const points = flowPoints(rows);
    expect(points[0]?.monthText).toBe('24-09');
    expect(points.at(-1)?.monthText).toBe('26-08');
    expect(points[0]!.x).toBeLessThan(points.at(-1)!.x);
  });

  test('2등 사정률은 창 안이면 y를, 없거나 창 밖이면 null을 둔다', () => {
    const [inside] = flowPoints([rows[0]!]);
    expect(inside?.runnerUpY).not.toBeNull();
    const [missing] = flowPoints([{ ...rows[0]!, secondRateText: null }]);
    expect(missing?.runnerUpY).toBeNull();
    const [outside] = flowPoints([{ ...rows[0]!, secondRateText: '91.500' }]);
    expect(outside?.runnerUpY).toBeNull();
  });

  test('명단 막대는 상한에서 잘리고 넘긴 수만 숫자로 남기며 모르는 회차는 막대가 없다', () => {
    const bars = listBars(flowPoints([
      { ...rows[0]!, attemptId: '1', listCount: LIST_BAR_CAP * 3 },
      { ...rows[0]!, attemptId: '2', listCount: LIST_BAR_CAP / 2 },
      { ...rows[0]!, attemptId: '3', listCount: null }
    ]));
    expect(bars.map((bar) => bar.key)).toEqual(['2', '1']);
    const [half, capped] = [bars[0]!, bars[1]!];
    expect(capped.top).toBe(BAR_TOP);
    expect(capped.overflowText).toBe(String(LIST_BAR_CAP * 3));
    expect(half.top).toBeCloseTo((BAR_TOP + BAR_BOTTOM) / 2);
    expect(half.overflowText).toBeNull();
  });

  test('회차가 촘촘하면 막대 폭이 간격에 맞춰 줄고 상한 초과 숫자는 접는다', () => {
    const wide = listBars(flowPoints(rows.slice(0, 3)));
    const dense = listBars(flowPoints([...rows, ...rows.map((row) => ({ ...row, attemptId: `${row.attemptId}-b` }))]));
    expect(dense[0]!.width).toBeLessThan(wide[0]!.width);
    // 40회차면 간격이 약 18px라 이웃 숫자가 한 줄로 이어진다. 숫자 없는 막대는 정확한 값을 표에 맡긴다.
    expect(wide.some((bar) => bar.overflowText !== null)).toBe(true);
    expect(dense.every((bar) => bar.overflowText === null)).toBe(true);
  });

  test('달 라벨은 달이 바뀌는 첫 회차에만 놓고 앞 라벨과 겹칠 만큼 가까우면 건너뛴다', () => {
    const points = flowPoints(rows);
    const labels = monthLabels(points);
    expect(labels[0]).toEqual({ x: points[0]!.x, text: '24-09' });
    for (let index = 1; index < labels.length; index += 1) {
      expect(labels[index]!.x - labels[index - 1]!.x).toBeGreaterThanOrEqual(46);
    }
    // 같은 달 회차 둘은 라벨 하나다.
    expect(monthLabels(flowPoints([rows[0]!, { ...rows[0]!, attemptId: 'x' }]))).toHaveLength(1);
  });

  test('내 값은 창 밖이면 방향만 남기고 창 안이면 눈금 사이 y를 준다', () => {
    expect(myRatePlacement('90.812').outside).toBe('above');
    expect(myRatePlacement('89.000').outside).toBe('below');
    expect(myRatePlacement('90.300').outside).toBeNull();
  });
});
