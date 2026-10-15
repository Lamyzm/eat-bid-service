import { describe, expect, test } from 'bun:test';
import { Temporal } from '@eatbid/domain';

import { linesResponse, myBidsResponse, regionsResponse } from '@/app/(workspace)/floor/__fixtures__/floor-lines';
import { floorPeriod } from '@/entities/floor-line/floor-period';
import { monthBands } from '@/app/(workspace)/floor/_lib/floor-stats';
import { rateText } from '@/entities/floor-line/floor-units';
import { findRegion, presentFloorData, presentRegionGroups } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { bandRects, ladderDots, mineDots, windowSummary } from './points-layers';

const period = floorPeriod(Temporal.PlainDate.from('2026-10-15'), '1y');
const region = findRegion(presentRegionGroups(regionsResponse), '459')!;
const data = presentFloorData({ lines: linesResponse({ ranks: true }), mine: { kind: 'bids', response: myBidsResponse() }, region });

describe('공고별 보기의 층', () => {
  test('달 띠는 공고가 넉넉한 달에만 서고 그 달 첫날부터 다음 달 첫날까지 걸친다', () => {
    const rects = bandRects(data.points, period, 0.2);
    // 지난 열두 달은 20건씩이라 띠가 서고, 이번 달 3건은 띠가 없다.
    expect(rects).toHaveLength(12);
    expect(rects[0]![0]).toBe(period.monthStarts['2025-10']);
    expect(rects[0]![1]).toBe(period.monthStarts['2025-11']);
    expect(Math.round((rects[0]![3] - rects[0]![2]) * 10) / 10).toBe(0.2);
  });

  test('1~10등과 우리 값은 같은 공고 점의 번호를 가리킨다', () => {
    const ladders = ladderDots(data.points, data.ladders);
    expect(ladders).toHaveLength(400);
    expect(ladders[0]).toEqual([data.points[0]!.t, data.ladders![0]!.lowest[0]!, 0, 1]);
    const mine = mineDots(data.points, data.mine);
    expect([mine.below.map((dot) => dot[2]), mine.valid.map((dot) => dot[2]), mine.won.map((dot) => dot[2])]).toEqual([[0], [1], [2]]);
  });

  test('보이는 기간 요약은 가장 잦은 칸 옆에 추첨만 돌려도 그만큼 든다는 말을 둔다', () => {
    const summary = windowSummary(data.points, [period.start, period.end], 0.2);
    expect(summary.headline).toStartWith('2025.10.2 ~ 2026.10.13 공고 243건: 넓게 보면 열 번 중 다섯 번이 사정률 ');
    expect(summary.note).toBe('추첨만 돌려도 가장 잦은 칸엔 이 정도가 들어가요(칸 하나에 10번 중 1번꼴). 특별히 몰리는 자리라는 뜻이 아니에요.');
    expect(summary.histogram.reduce((sum, bin) => sum + bin[2], 0)).toBe(243);
    expect(windowSummary(data.points, [0, 1], 0.1).headline).toBe('이 기간에는 공고가 없어요.');
  });

  test('한 달로 확대하면 가장 잦은 칸이 달 띠·달별 표와 같은 칸·같은 건수다', () => {
    const start = period.monthStarts['2026-09']!;
    const end = period.monthStarts['2026-10']! - 1;
    const band = monthBands(data.points, 0.2).find((entry) => entry.month === '2026-09')!;
    const summary = windowSummary(data.points, [start, end], 0.2);
    expect(summary.headline).toContain(`가장 잦은 칸은 사정률 ${rateText(band.lo, 2)}~${rateText(band.hi, 2)}(${band.inside}건,`);
  });
});
