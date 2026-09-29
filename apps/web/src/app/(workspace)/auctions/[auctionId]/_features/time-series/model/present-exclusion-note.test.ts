import { describe, expect, test } from 'bun:test';
import type {
  AnalysisFilterValue,
  AnalysisMeta,
  AnalysisTimeSeriesV1Response
} from '@eatbid/contracts/api/v1/analysis';
import { presentExclusionNote } from './present-exclusion-note';

type PeriodCoverage = Extract<AnalysisMeta, { state: 'ready' }>['periodCoverage'];

const filter = {
  targetOrganizationId: '41',
  excludeAttemptId: null,
  period: { from: '2026-07-15', to: '2026-09-14' },
  dateBasis: 'opened',
  comparisonScope: { kind: 'national' },
  floorRate: { value: '90.000', unit: 'percentage-points' },
  awardMethodCodeValueId: '31',
  listCountRange: { min: null, max: null },
  itemFilter: { kind: 'all' },
  overlayOrganizationIds: []
} satisfies AnalysisFilterValue;

function segment(from: string, to: string, excluded: number, unresolved: number) {
  return {
    period: { from, to },
    target: 'complete' as const,
    comparison: 'complete' as const,
    exclusions: { excludedAuctionCount: excluded, unresolvedAuctionCount: unresolved }
  };
}

function responseWith(periodCoverage: PeriodCoverage): AnalysisTimeSeriesV1Response {
  return {
    axis: null,
    target: null,
    targetTruncated: false,
    comparison: null,
    overlays: null,
    meta: {
      state: 'ready',
      effectiveFilter: filter,
      snapshot: {
        sourceCutoffAt: '2026-09-01T00:00:00Z',
        issuedAt: '2026-09-02T00:00:00Z',
        expiresAt: '2026-09-03T00:00:00Z',
        observationPolicyVersion: 'awarded-attempt-v1',
        builds: []
      },
      targetSampleCount: 0,
      comparisonSampleCount: 0,
      overlapCount: 0,
      periodCoverage,
      freshness: { state: 'unknown', checkedAt: null }
    }
  };
}

describe('제외 공고 문장', () => {
  test('제외가 있는 달과 수를 표본과 섞지 않고 한 문장으로 말한다', () => {
    const note = presentExclusionNote(
      responseWith([
        segment('2026-07-15', '2026-07-31', 0, 0),
        segment('2026-08-01', '2026-08-31', 2, 1),
        segment('2026-09-01', '2026-09-14', 1, 0)
      ])
    );
    expect(note).toBe(
      '이 기간 전국 수집에서 원천 형식 문제로 발행에서 뺀 공고가 3건 있어요(2026-08 2건, 2026-09 1건). ' +
        '그중 1건은 아직 반영되지 않아 표본에서 빠졌거나 이전 내용으로 들어 있어요.'
    );
  });

  test('모두 다시 반영됐으면 그렇게 말하고 제외가 없거나 자료가 없으면 아무 말도 하지 않는다', () => {
    expect(
      presentExclusionNote(responseWith([segment('2026-07-15', '2026-09-14', 1, 0)]))
    ).toContain('모두 다시 반영됐어요.');
    expect(
      presentExclusionNote(responseWith([segment('2026-07-15', '2026-09-14', 0, 0)]))
    ).toBeNull();
    expect(
      presentExclusionNote({
        ...responseWith([]),
        meta: { state: 'unavailable', effectiveFilter: filter, reason: 'snapshot-unavailable' }
      })
    ).toBeNull();
  });
});
