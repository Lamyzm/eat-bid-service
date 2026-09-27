import { describe, expect, test } from 'bun:test';
import type { AnalysisHistoryRow } from '@eatbid/contracts/api/v1/analysis';
import { presentHistoryRow } from './present-history';

const row: AnalysisHistoryRow = {
  attemptId: '248067',
  revisionId: '130770',
  organizationId: '6545',
  organizationName: '광운인공지능고등학교',
  announcedAt: '2026-08-17T15:00:00Z',
  openedAt: '2026-08-27T23:00:00Z',
  items: ['육류', '가금류'],
  assessmentRate: { value: '90.002', unit: 'percentage-points' },
  secondRate: { value: '90.013', unit: 'percentage-points' },
  listCount: 256,
  belowDayFloorCount: 218,
  winner: { supplierPartyId: '1828', name: '바다푸드' },
  baseAmount: { amount: '14070870.00', currency: 'KRW' }
};

describe('전체 개찰 이력 줄 표시', () => {
  test('날짜는 조건의 기준 시각을 KST 날짜로 쓴다', () => {
    // 개찰 23:00Z는 KST로 다음 날이다. 그림의 가로축과 같은 날짜여야 같은 회차로 읽힌다.
    expect(presentHistoryRow(row, 'opened').dateText).toBe('2026-08-28');
    expect(presentHistoryRow(row, 'announced').dateText).toBe('2026-08-18');
  });

  test('2순위 차는 부호를 붙이고 낮으면 음수 그대로 적는다', () => {
    expect(presentHistoryRow(row, 'opened').secondGapText).toBe('+0.011');
    const lower = { ...row, secondRate: { value: '89.986', unit: 'percentage-points' as const } };
    expect(presentHistoryRow(lower, 'opened').secondGapText).toBe('−0.016');
  });

  test('명단을 관측하지 못한 회차는 0곳이 아니라 미관측이라고 말한다', () => {
    expect(presentHistoryRow(row, 'opened').listText).toBe('256곳 · 하한 미만 218');
    expect(
      presentHistoryRow({ ...row, listCount: null, belowDayFloorCount: null }, 'opened').listText
    ).toBe('명단 미관측');
  });

  test('품목·업체·기관 이름이 없으면 지어내지 않고 미확인이라고 쓴다', () => {
    const blank = {
      ...row,
      items: null,
      organizationName: null,
      winner: { supplierPartyId: '1', name: null }
    };
    const view = presentHistoryRow(blank, 'opened');
    expect(view.itemText).toBe('품목 미확인');
    expect(view.organizationText).toBe('기관명 미확인');
    expect(view.winnerText).toBe('업체명 미확인');
  });
});
