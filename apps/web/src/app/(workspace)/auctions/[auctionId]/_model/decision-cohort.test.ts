import { describe, expect, test } from 'bun:test';

import { auctionFixture } from '../__fixtures__/auction';
import type { DecisionSearch } from '../_lib/decision-search-params';
import { cohortOf, periodOf } from './decision-cohort';

const search: DecisionSearch = {
  period: '12개월',
  scope: '전국',
  view: '비교집단',
  item: null,
  myRate: null,
  rate: null,
  expand: false
};

const period = { from: '2025-10', to: '2026-09' };

describe('결정 화면 코호트', () => {
  test('기간 칩 넷이 지금 KST 달을 끝으로 하는 달 구간을 만든다', () => {
    const now = '2026-09-06T01:00:00Z';
    expect(periodOf('12개월', now)).toEqual({ from: '2025-10', to: '2026-09' });
    expect(periodOf('3개월', now)).toEqual({ from: '2026-07', to: '2026-09' });
    expect(periodOf('이번 달', now)).toEqual({ from: '2026-09', to: '2026-09' });
    expect(periodOf('지난 달', now)).toEqual({ from: '2026-08', to: '2026-08' });
  });

  test('연말 경계에서 달과 해가 함께 넘어간다', () => {
    expect(periodOf('12개월', '2026-01-15T00:00:00Z')).toEqual({ from: '2025-02', to: '2026-01' });
    expect(periodOf('지난 달', '2026-01-15T00:00:00Z')).toEqual({ from: '2025-12', to: '2025-12' });
    expect(periodOf('3개월', '2026-02-01T00:00:00Z')).toEqual({ from: '2025-12', to: '2026-02' });
  });

  test('달 경계는 UTC가 아니라 KST다', () => {
    // 2026-08-31T16:00Z는 KST로 9월 1일 01:00이다. UTC로 읽으면 8월이 된다.
    expect(periodOf('이번 달', '2026-08-31T16:00:00Z')).toEqual({ from: '2026-09', to: '2026-09' });
    expect(periodOf('이번 달', '2026-08-31T14:00:00Z')).toEqual({ from: '2026-08', to: '2026-08' });
  });

  test('네 모집단 칩이 공고 응답의 축을 그대로 코호트로 옮긴다', () => {
    expect(cohortOf(auctionFixture, search, period)).toEqual({
      kind: 'ready',
      cohort: { scope: 'national', floorRate: '90.000', awardMethod: '31', from: '2025-10', to: '2026-09' }
    });
    expect(cohortOf(auctionFixture, { ...search, scope: '도' }, period)).toMatchObject({
      cohort: { scope: 'province', regionCodeValueId: '41' }
    });
    expect(cohortOf(auctionFixture, { ...search, scope: '시군' }, period)).toMatchObject({
      cohort: { scope: 'district', regionCodeValueId: '43' }
    });
    expect(cohortOf(auctionFixture, { ...search, scope: '이 기관' }, period)).toMatchObject({
      cohort: { scope: 'organization', organizationId: '3101' }
    });
  });

  test('하한율이나 낙찰방식이 없으면 어떤 모집단도 만들지 않는다', () => {
    const unobserved = { ...auctionFixture, terms: null };
    for (const scope of ['전국', '도', '시군', '이 기관'] as const) {
      expect(cohortOf(unobserved, { ...search, scope }, period)).toEqual({ kind: 'missing-terms' });
    }
    expect(cohortOf({ ...auctionFixture, terms: { floorRate: null, awardMethod: null } }, search, period))
      .toEqual({ kind: 'missing-terms' });
  });

  test('지역이나 기관 축이 없으면 그 모집단만 잠그고 전국은 그대로 만든다', () => {
    const noAxis = { ...auctionFixture, location: null, organization: null };
    expect(cohortOf(noAxis, { ...search, scope: '도' }, period)).toEqual({ kind: 'missing-axis' });
    expect(cohortOf(noAxis, { ...search, scope: '시군' }, period)).toEqual({ kind: 'missing-axis' });
    expect(cohortOf(noAxis, { ...search, scope: '이 기관' }, period)).toEqual({ kind: 'missing-axis' });
    expect(cohortOf(noAxis, search, period).kind).toBe('ready');
  });
});
