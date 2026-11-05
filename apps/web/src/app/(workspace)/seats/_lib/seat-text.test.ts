import { describe, expect, test } from 'bun:test';
import { Temporal } from '@eatbid/domain';

import { businessNumberText, grantLastDay, lastDayOf, rejectionText, seatStanding, standingText } from './seat-text';

const now = Temporal.Instant.from('2026-11-05T03:00:00Z'); // KST 11-05 12:00

describe('시장 자리 문구와 날짜', () => {
  test('끝나는 날은 반열림 끝의 직전 KST 날짜이고, 회수로 잘린 끝은 그날이다', () => {
    expect(lastDayOf('2027-02-05T15:00:00Z').toString()).toBe('2027-02-05');
    expect(lastDayOf('2026-11-10T03:00:00Z').toString()).toBe('2026-11-10');
  });

  test('주기 미리보기는 시작일에 개월 수를 더한 전날까지다', () => {
    expect(grantLastDay(Temporal.PlainDate.from('2026-11-06'), 3).toString()).toBe('2027-02-05');
  });

  test('14일 안에 끝나면 남은 날을 함께 말하고 끝난 자리는 끝남이다', () => {
    const seat = { startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-10T15:00:00Z' };
    expect(standingText(seatStanding(seat, now), seat, now)).toBe('곧 끝남 · 6일 남음');
    const soon = { startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-15T15:00:00Z' };
    expect(standingText(seatStanding(soon, now), soon, now)).toBe('쓰는 중 · 11일 남음');
    const ended = { startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' };
    expect(standingText(seatStanding(ended, now), ended, now)).toBe('끝남');
  });

  test('겹침 거절은 누가 언제까지 쓰는지와 다음 행동을 말한다', () => {
    expect(rejectionText({
      reason: 'period-overlap', holder: { workspaceId: '1', name: '오뚜기축산' }, holderEndsAt: '2027-02-05T15:00:00Z'
    })).toBe('기간이 겹칩니다. 이 시장은 오뚜기축산 업체가 2027-02-05까지 씁니다. 그다음 날부터로 바꿔 주세요.');
    expect(businessNumberText('1248100998')).toBe('124-81-00998');
  });
});
