import { describe, expect, test } from 'bun:test';
import { Temporal } from '../time/temporal';
import { analysisMonthPeriod } from './month-period';

describe('분석 달력월 프리셋', () => {
  test('현재 KST 날짜까지 지정한 달력월을 포함하고 윤년과 해 경계를 보존한다', () => {
    const period = analysisMonthPeriod(Temporal.PlainDate.from('2024-02-29'), 3);
    expect(period.from.toString()).toBe('2023-12-01');
    expect(period.to.toString()).toBe('2024-02-29');
    expect(analysisMonthPeriod(Temporal.PlainDate.from('2026-09-15'), 1).from.toString()).toBe(
      '2026-09-01'
    );
  });
});
