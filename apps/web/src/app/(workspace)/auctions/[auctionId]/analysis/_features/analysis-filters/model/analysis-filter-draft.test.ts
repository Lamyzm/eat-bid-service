import { describe, expect, test } from 'bun:test';
import {
  openAuctionFixture,
  fixtureNow
} from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/auction';
import { presentAnalysisFilters, readAppliedAnalysis } from './present-analysis-filters';
import { validateAnalysisDraft } from './analysis-filter-draft';

describe('공통 비교조건 초안과 적용', () => {
  const setup = presentAnalysisFilters(openAuctionFixture, fixtureNow);

  test('기관과 현재 공고의 ID를 유지하고 명단 양끝·한쪽·전체를 구분한다', () => {
    for (const [min, max] of [
      ['12', '24'],
      ['12', ''],
      ['', '24'],
      ['', ''],
      ['0', '0']
    ]) {
      const parsed = validateAnalysisDraft({ ...setup.initialDraft, min, max }, setup);
      expect(parsed.state).toBe('valid');
      if (parsed.state !== 'valid') throw new Error('유효한 조건이어야 합니다');
      expect(parsed.filter.excludeAttemptId).toBe(openAuctionFixture.identity.auctionId);
      expect(parsed.filter.targetOrganizationId).toBe('3101');
      expect(parsed.filter.listCountRange).toEqual({
        min: min === '' ? null : Number(min),
        max: max === '' ? null : Number(max)
      });
    }
  });

  test('잘못된 날짜와 명단 범위는 필드 옆 오류로 반환한다', () => {
    for (const draft of [
      { ...setup.initialDraft, from: '2026-02-30' },
      { ...setup.initialDraft, from: '2027-01-01', to: '2026-01-01' },
      { ...setup.initialDraft, min: '24', max: '12' },
      { ...setup.initialDraft, min: '-1' },
      { ...setup.initialDraft, max: '2.5' },
      { ...setup.initialDraft, min: '2147483648' }
    ])
      expect(validateAnalysisDraft(draft, setup).state).toBe('invalid');
  });

  test('미확인 기관과 공고 조건을 기본 코드로 채우지 않는다', () => {
    const missing = presentAnalysisFilters(
      { ...openAuctionFixture, organization: null, terms: null },
      fixtureNow
    );
    expect(missing.targetOrganizationId).toBeNull();
    expect(validateAnalysisDraft(missing.initialDraft, missing).state).toBe('invalid');
    expect(missing.options.awardMethods).toHaveLength(0);
    expect(missing.presets.find((preset) => preset.value === 'all')?.period).toBeNull();
  });

  test('관측 밖 지역과 미지원 기관 품목을 제출할 수 없다', () => {
    expect(
      validateAnalysisDraft(
        {
          ...setup.initialDraft,
          comparisonScope: {
            kind: 'region',
            codeValueId: '999',
            scheme: 'eat:auction-location-sido'
          }
        },
        setup
      ).state
    ).toBe('invalid');
    expect(validateAnalysisDraft({ ...setup.initialDraft, item: '99' }, setup).state).toBe(
      'invalid'
    );
    const parsed = validateAnalysisDraft(
      {
        ...setup.initialDraft,
        comparisonScope: { kind: 'region', codeValueId: '41', scheme: 'eat:auction-location-sido' }
      },
      setup
    );
    if (parsed.state !== 'valid') throw new Error('지역 조건이어야 합니다');
    expect(parsed.filter.comparisonScope).toEqual({
      kind: 'region',
      codeValueId: '41',
      scheme: 'eat:auction-location-sido'
    });
  });

  test('다른 공고·기관을 담은 주소와 잘못된 JSON을 원래 조회로 되돌려 해석하지 않는다', () => {
    expect(readAppliedAnalysis(null, setup).state).toBe('pending');
    expect(readAppliedAnalysis('{bad', setup).state).toBe('invalid');
    const parsed = validateAnalysisDraft(setup.initialDraft, setup);
    if (parsed.state !== 'valid') throw new Error('유효한 조건이어야 합니다');
    expect(readAppliedAnalysis(JSON.stringify(parsed.filter), setup).state).toBe('pending');
    expect(
      readAppliedAnalysis(JSON.stringify({ ...parsed.filter, excludeAttemptId: '111' }), setup)
        .state
    ).toBe('invalid');
    expect(
      readAppliedAnalysis(JSON.stringify({ ...parsed.filter, targetOrganizationId: '999' }), setup)
        .state
    ).toBe('invalid');
  });

  test('지역 ID가 같아도 다른 코드 체계의 조건은 허용하지 않는다', () => {
    const parsed = validateAnalysisDraft(setup.initialDraft, setup);
    if (parsed.state !== 'valid') throw new Error('유효한 조건이어야 합니다');
    expect(
      readAppliedAnalysis(
        JSON.stringify({
          ...parsed.filter,
          comparisonScope: {
            kind: 'region',
            codeValueId: '41',
            scheme: 'eat:auction-location-sigungu'
          }
        }),
        setup
      ).state
    ).toBe('invalid');
  });
});
