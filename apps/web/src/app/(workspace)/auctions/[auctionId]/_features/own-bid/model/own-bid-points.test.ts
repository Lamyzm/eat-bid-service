import { describe, expect, test } from 'bun:test';
import type { MyAttemptBidObservation, MyBidSubmission } from '@eatbid/contracts/api/v1/me';

import { attemptsFixture } from '../../../__fixtures__/attempts';
import { presentHistory, type HistoryRow } from '../../history/model/attempt-history';
import { buildOwnPoints, ownObservedRange, ownSummaryText, summarizeOwnAttempts } from './own-bid-points';

// 물어본 회차 열쇠는 서버가 표 행에서 뽑아 provider에 넘기는 것과 같은 모양이다.
const asked = (rows: readonly HistoryRow[]) => rows.map((row) => ({ attemptId: row.attemptId, revisionId: row.revisionId! }));

const baseRow = presentHistory(attemptsFixture, null).rows[0]!;
const provenance = {
  sourceSystem: 'eat',
  observationId: '6101',
  normalizedRecordId: '5101',
  contentSha256: 'a'.repeat(64)
} as const;

function row(attemptId: string, revisionId: string, overrides: Partial<HistoryRow> = {}): HistoryRow {
  return { ...baseRow, attemptId, revisionId, openedAt: '2026-09-05T05:00:00Z', openedKstDay: 20_700, ...overrides };
}

function submission(attemptId: string, index: number, overrides: Partial<MyBidSubmission> = {}): MyBidSubmission {
  return {
    submissionId: `${attemptId}${index}`,
    rosterOrdinal: index,
    supplierPartyId: '7701',
    sourceSupplierAccountId: '7801',
    sourceCalculatedAmount: { amount: '10000000043768.00', currency: 'KRW' },
    submittedAmount: null,
    bidRate: { value: '89.001', unit: 'percentage-points' },
    rank: null,
    submittedAt: null,
    sourceStatus: { codeValueId: '7201', code: '005', scheme: 'eat:bid-status', label: null },
    ...overrides
  };
}

function submitted(attemptId: string, revisionId: string, rows: readonly Partial<MyBidSubmission>[]): MyAttemptBidObservation {
  return {
    attemptId,
    revisionId,
    result: {
      kind: 'submitted',
      rows: rows.map((overrides, index) => submission(attemptId, index, overrides)),
      rosterRowCount: rows.length,
      observedAt: '2026-09-05T03:04:05Z',
      provenance
    }
  };
}

describe('내 투찰 표시 모델', () => {
  test('같은 회차의 여러 제출과 같은 날의 여러 회차를 점 하나로 합치지 않는다', () => {
    const rows = [row('8101', '9101'), row('8201', '9201')];
    const observed = [submitted('8101', '9101', [{}, { bidRate: { value: '101.975', unit: 'percentage-points' } }]), submitted('8201', '9201', [{}])];
    const points = buildOwnPoints(rows, observed);
    expect(points).toHaveLength(3);
    expect(new Set(points.map((point) => point.submissionId)).size).toBe(3);
    expect(points.every((point) => point.time === points[0]!.time)).toBe(true);
    expect(summarizeOwnAttempts(asked(rows), observed)).toEqual({ submitted: 2, submissions: 3, absent: 0, notObserved: 0, conflict: 0 });
  });

  test('비율은 원문 셋째 자리 그대로이고 100 초과를 지우지 않으며 숫자는 좌표 전용이다', () => {
    const points = buildOwnPoints(
      [row('8101', '9101')],
      [submitted('8101', '9101', [{ bidRate: { value: '101.975', unit: 'percentage-points' } }])]
    );
    expect(points[0]?.rateText).toBe('101.975');
    expect(points[0]?.value).toBe(101.975);
  });

  test('제출 금액이 없으면 계산용 자리표시자로 채우지 않고 금액 미확인이다', () => {
    const points = buildOwnPoints(
      [row('8101', '9101')],
      [submitted('8101', '9101', [{}, { submittedAmount: { amount: '43120180.00', currency: 'KRW' } }])]
    );
    expect(points.map((point) => point.amountText)).toEqual([null, '43,120,180']);
    expect(points.some((point) => point.amountText?.includes('10,000,000,043,768'))).toBe(false);
  });

  test('물어본 revision과 다른 결과는 점으로 그리지 않고 확인 불가로 센다', () => {
    const rows = [row('8101', '9111')];
    const observed = [submitted('8101', '9101', [{}])];
    expect(buildOwnPoints(rows, observed)).toHaveLength(0);
    expect(summarizeOwnAttempts(asked(rows), observed).conflict).toBe(1);
    // 묻지도 않은 회차의 답도 어느 명단인지 말할 수 없어 같은 수로 센다.
    expect(summarizeOwnAttempts([], observed).conflict).toBe(1);
  });

  test('명단에 없음·미관측·증거 불일치를 서로 다른 수로 세고 문구가 미참여를 말하지 않는다', () => {
    const attempts: MyAttemptBidObservation[] = [
      { attemptId: '1', revisionId: '11', result: { kind: 'absent-from-roster', rosterRowCount: 2, observedAt: '2026-09-05T03:04:05Z', provenance } },
      { attemptId: '2', revisionId: '12', result: { kind: 'roster-not-observed', provenance } },
      { attemptId: '3', revisionId: '13', result: { kind: 'evidence-conflict', reason: 'roster-count-mismatch' } }
    ];
    const rows = [row('1', '11'), row('2', '12'), row('3', '13')];
    const summary = summarizeOwnAttempts(asked(rows), attempts);
    expect(summary).toEqual({ submitted: 0, submissions: 0, absent: 1, notObserved: 1, conflict: 1 });
    expect(buildOwnPoints(rows, attempts)).toHaveLength(0);
    const text = ownSummaryText(summary);
    expect(text).toBe('명단에 없음 1회 · 명단 미관측 1회 · 확인 불가 1회');
    expect(text).not.toContain('미참여');
    expect(ownSummaryText({ submitted: 0, submissions: 0, absent: 0, notObserved: 0, conflict: 0 })).toBe('조회한 회차에 내 제출 기록이 없습니다');
  });

  test('개찰일이 없는 행의 결과는 점으로 놓지 않지만 요약에는 센다', () => {
    const rows = [row('8101', '9101', { openedAt: null })];
    const observed = [submitted('8101', '9101', [{}])];
    expect(buildOwnPoints(rows, observed)).toHaveLength(0);
    expect(summarizeOwnAttempts(asked(rows), observed).submitted).toBe(1);
  });

  test('점 범위는 값 사이에 여백을 두고 0 아래로 내려가지 않는다', () => {
    const points = buildOwnPoints(
      [row('8101', '9101')],
      [submitted('8101', '9101', [{ bidRate: { value: '0.001', unit: 'percentage-points' } }, { bidRate: { value: '89.001', unit: 'percentage-points' } }])]
    );
    const range = ownObservedRange(points);
    expect(range?.from).toBe(0);
    expect(range?.to).toBeGreaterThan(89.001);
    expect(ownObservedRange([])).toBeNull();
  });
});
