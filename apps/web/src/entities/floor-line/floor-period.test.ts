import { describe, expect, test } from 'bun:test';
import { floorLineV1Operations } from '@eatbid/contracts/api/v1/analysis';
import { Temporal } from '@eatbid/domain';

import { floorPeriod } from './floor-period';

describe('기간 칩의 조회 창', () => {
  test('창은 달 첫날에서 시작해 오늘에서 끝나고 이번 달과 다음 달 첫날까지 달 경계를 싣는다', () => {
    const period = floorPeriod(Temporal.PlainDate.from('2026-10-15'), '3m');
    expect([period.from, period.to, period.currentMonth]).toEqual(['2026-07-01', '2026-10-15', '2026-10']);
    expect(Object.keys(period.monthStarts)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    // KST 자정이라 UTC로는 전날 15시다.
    expect(period.monthStarts['2026-10']).toBe(Temporal.Instant.from('2026-09-30T15:00:00Z').epochMilliseconds);
    expect(period.end).toBe(Temporal.Instant.from('2026-10-15T15:00:00Z').epochMilliseconds);
  });

  test('가장 긴 3년 창도 어느 날이든 계약의 기간 상한 안에 든다', () => {
    const query = floorLineV1Operations.findRegions.querySchema;
    for (let day = Temporal.PlainDate.from('2026-01-01'); Temporal.PlainDate.compare(day, Temporal.PlainDate.from('2029-01-01')) < 0; day = day.add({ days: 1 })) {
      const period = floorPeriod(day, '3y');
      expect(query.safeParse({ from: period.from, to: period.to, floorRate: '90.000' }).success).toBe(true);
    }
  });
});
