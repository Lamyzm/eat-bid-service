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

  test('고른 품목과 미확인은 DTO의 한 조건으로 접히고 빈 선택이 전체다', () => {
    const all = validateAnalysisDraft(setup.initialDraft, setup);
    if (all.state !== 'valid') throw new Error('전체 품목이어야 합니다');
    expect(all.filter.itemFilter).toEqual({ kind: 'all' });

    const atoms = validateAnalysisDraft(
      { ...setup.initialDraft, items: ['육류', '가금류'], itemUnknown: true },
      setup
    );
    if (atoms.state !== 'valid') throw new Error('품목 조건이어야 합니다');
    expect(atoms.filter.itemFilter).toEqual({ kind: 'atoms', atoms: ['육류', '가금류'], unknown: true });

    // 미확인만 고른 상태는 전체가 아니다. 전체로 접으면 3분의 1만 보려던 조건이 조용히 전부가 된다.
    const unknown = validateAnalysisDraft({ ...setup.initialDraft, itemUnknown: true }, setup);
    if (unknown.state !== 'valid') throw new Error('미확인 조건이어야 합니다');
    expect(unknown.filter.itemFilter).toEqual({ kind: 'unknown' });
  });

  test('이 공고에 없는 지역도 조건으로 담는다', () => {
    // 비교 지역은 조건 사전 전체에서 고른다. 화면이 이 공고가 관측한 둘로 막으면 다른 시군구와 비교할
    // 길이 없어진다. 없는 코드값의 판정은 서버가 하며 그때는 404다.
    const other = validateAnalysisDraft(
      {
        ...setup.initialDraft,
        comparisonScope: { kind: 'region', codeValueId: '999', scheme: 'eat:auction-location-sido' }
      },
      setup
    );
    if (other.state !== 'valid') throw new Error('다른 지역도 조건이 되어야 합니다');
    expect(other.filter.comparisonScope).toEqual({
      kind: 'region',
      codeValueId: '999',
      scheme: 'eat:auction-location-sido'
    });
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

  test('지역 코드값은 체계와 함께 실려 다른 어휘로 읽히지 않는다', () => {
    const parsed = validateAnalysisDraft(setup.initialDraft, setup);
    if (parsed.state !== 'valid') throw new Error('유효한 조건이어야 합니다');
    // 같은 숫자가 시도에도 시군구에도 있다. 둘을 가르는 것은 함께 실린 체계이며, 그 짝이 실제로 있는
    // 구역인지는 서버가 체계까지 조인해 확인한다(AGENTS 6).
    const applied = readAppliedAnalysis(
      JSON.stringify({
        ...parsed.filter,
        comparisonScope: { kind: 'region', codeValueId: '41', scheme: 'eat:auction-location-sigungu' }
      }),
      setup
    );
    if (applied.state !== 'pending') throw new Error('조건으로 읽혀야 합니다');
    expect(applied.filter.comparisonScope).toEqual({
      kind: 'region',
      codeValueId: '41',
      scheme: 'eat:auction-location-sigungu'
    });
  });
});
