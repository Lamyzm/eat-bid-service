import { describe, expect, test } from 'bun:test';
import { attemptsFixture } from '../../../__fixtures__/attempts';
import { presentHistory } from '../../history/model/attempt-history';
import { buildFlowChartModel } from './flow-chart-model';
import type { OrganizationAuctionAttempt } from '@eatbid/contracts/api/v1/organizations';

const base: OrganizationAuctionAttempt = { ...attemptsFixture.attempts[0]!, awardMethodCodeValueId: '31' };
const row = (attemptId: string, openedAt: string, extra: Partial<OrganizationAuctionAttempt> = {}) => ({ ...base, attemptId, openedAt, ...extra });
const model = (attempts: OrganizationAuctionAttempt[]) => buildFlowChartModel(presentHistory({ ...attemptsFixture, attempts }, null));

describe('기관 흐름 차트 데이터 경계', () => {
  test('같은 날짜의 다른 회차를 덮어쓰거나 가짜 시각으로 옮기지 않는다', () => {
    const result = model([row('3', '2026-07-03T00:00:00Z'), row('2', '2026-07-01T05:00:00Z'), row('1', '2026-07-01T01:00:00Z')]);
    expect(result.points).toHaveLength(3);
    expect(result.points[0]?.time).toBe(result.points[1]?.time);
    expect(result.calendar).toHaveLength(3);
    expect(result.series.flatMap((series) => series.points).map((point) => point.row.attemptId).toSorted()).toEqual(['1', '2', '3']);
    expect(result.series.every((series) => new Set(series.points.map((point) => point.time)).size === series.points.length)).toBe(true);
  });

  test('품목·하한·방식이 다른 회차와 미확인 조건을 하나의 추이선으로 잇지 않는다', () => {
    const result = model([
      row('5', '2026-07-05T00:00:00Z', { awardMethodCodeValueId: null }),
      row('4', '2026-07-04T00:00:00Z', { awardMethodCodeValueId: '32' }),
      row('3', '2026-07-03T00:00:00Z', { floorRate: { value: '88.000', unit: 'percentage-points' } }),
      row('2', '2026-07-02T00:00:00Z', { item: null }),
      row('1', '2026-07-01T00:00:00Z')
    ]);
    expect(result.series.every((series) => series.points.length === 1)).toBe(true);
  });

  test('낙찰값이 없는 중간 회차를 가로질러 선을 잇지 않는다', () => {
    const result = model([row('3', '2026-07-03T00:00:00Z'), row('2', '2026-07-02T00:00:00Z', { winRate: null }), row('1', '2026-07-01T00:00:00Z')]);
    expect(result.points).toHaveLength(2);
    expect(result.series).toHaveLength(2);
    expect(result.calendar).toHaveLength(3);
  });

  test('낙찰값이 하나도 없어도 개찰일이 있으면 달력을 만들어 own 점만으로 엔진이 설 수 있다', () => {
    const result = model([row('2', '2026-07-02T00:00:00Z', { winRate: null }), row('1', '2026-07-01T00:00:00Z', { winRate: null })]);
    expect(result.points).toHaveLength(0);
    expect(result.calendar).toHaveLength(2);
  });

  test('차트 좌표만 근사 숫자로 바꾸고 원문 비율과 큰 회차 ID를 보존한다', () => {
    const result = model([row('9007199254740993', '2026-07-01T00:00:00Z', { winRate: { value: '101.123', unit: 'percentage-points' } })]);
    expect(result.points[0]?.row.winRateText).toBe('101.123');
    expect(result.points[0]?.row.attemptId).toBe('9007199254740993');
    expect(result.points[0]?.value).toBe(101.123);
  });
});
