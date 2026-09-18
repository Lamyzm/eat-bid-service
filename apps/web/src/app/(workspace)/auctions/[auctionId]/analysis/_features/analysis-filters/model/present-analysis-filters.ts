/** @module 책임: 현재 공고의 관측 코드와 주입 시각으로 필터 초안을 준비하고 URL 조건을 해당 공고에 한정한다. */
import {
  analysisDateRange,
  analysisMonthPeriod,
  analysisListCountRange,
  sampleCount,
  Temporal
} from '@eatbid/domain';
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';
import {
  analysisFilterValueSchema,
  analysisRegionOptionSchema
} from '@eatbid/contracts/api/v1/analysis';
import type { AnalysisFilterSetup, AppliedAnalysis } from './analysis-filter-types';
import { draftOfAnalysis, validateAnalysisDraft } from './analysis-filter-draft';

const observedRegionSchema = analysisRegionOptionSchema.omit({
  active: true,
  parentCodeValueId: true
});

export function presentAnalysisFilters(
  auction: AuctionV1Response,
  now: string
): AnalysisFilterSetup {
  const today = Temporal.Instant.from(now).toZonedDateTimeISO('Asia/Seoul').toPlainDate();
  const presets = ([12, 6, 3, 2, 1] as const).map((months) => {
    const period = analysisMonthPeriod(today, months);
    return {
      value: String(months),
      label: months === 12 ? '1년' : `${months}개월`,
      period: { from: period.from.toString(), to: period.to.toString() }
    };
  });
  const regions = [auction.location?.sido, auction.location?.sigungu].flatMap((value) => {
    if (!value) return [];
    // 현재 공고에서 관측됐다는 사실만 제공한다. 사전의 활성 여부를 모르므로 active를 만들지 않는다.
    const parsed = observedRegionSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  const firstPeriod = presets[0].period;
  return {
    targetOrganizationId: auction.organization?.organizationId ?? null,
    excludeAttemptId: auction.identity.auctionId,
    organizationLabel:
      auction.organization?.name ?? (auction.organization ? '기관명 미확인' : '기관 미확인'),
    options: {
      regions,
      floorRates: auction.terms?.floorRate ? [auction.terms.floorRate] : [],
      awardMethods: auction.terms?.awardMethod ? [auction.terms.awardMethod] : [],
      availablePeriods: { opened: null, announced: null }
    },
    presets: [{ value: 'all', label: '전 기간', period: null }, ...presets],
    initialDraft: {
      ...firstPeriod,
      dateBasis: 'opened',
      comparisonScope: regions[0]
        ? { kind: 'region', scheme: regions[0].scheme, codeValueId: regions[0].codeValueId }
        : { kind: 'national' },
      floor: auction.terms?.floorRate?.value ?? '',
      awardMethod: auction.terms?.awardMethod?.codeValueId ?? '',
      min: '',
      max: '',
      items: [],
      itemUnknown: false
    }
  };
}

/** 주소는 사용자 입력이다. 다른 공고/기관 ID와 잘못된 조건을 기존 기관 이력으로 조용히 치환하지 않는다. */
export function readAppliedAnalysis(
  raw: string | null | undefined,
  setup: AnalysisFilterSetup
): AppliedAnalysis {
  const invalid = {
    state: 'invalid',
    key: raw ?? null,
    message: '이 공고에 적용할 수 없는 비교조건이에요. 조건을 다시 선택해 주세요.'
  } as const;
  if (raw == null) {
    const initial = validateAnalysisDraft(setup.initialDraft, setup);
    return initial.state === 'valid'
      ? { state: 'pending', key: null, filter: initial.filter }
      : invalid;
  }
  if (raw.length > 4096) return invalid;
  try {
    const filter = analysisFilterValueSchema.parse(JSON.parse(raw));
    if (
      filter.targetOrganizationId !== setup.targetOrganizationId ||
      filter.excludeAttemptId !== setup.excludeAttemptId
    )
      return invalid;
    analysisDateRange(
      Temporal.PlainDate.from(filter.period.from),
      Temporal.PlainDate.from(filter.period.to)
    );
    analysisListCountRange(
      filter.listCountRange.min === null ? null : sampleCount(BigInt(filter.listCountRange.min)),
      filter.listCountRange.max === null ? null : sampleCount(BigInt(filter.listCountRange.max))
    );
    const checked = validateAnalysisDraft(draftOfAnalysis(filter), setup);
    if (checked.state !== 'valid') return invalid;
    if (JSON.stringify(checked.filter.comparisonScope) !== JSON.stringify(filter.comparisonScope))
      return invalid;
    return { state: 'pending', key: raw, filter };
  } catch {
    return invalid;
  }
}
