/** @module 책임: 필터 폼의 문자열을 공통 DTO로 옮기고 사용자에게 고칠 입력을 알려준다. 서버 인가를 대신하지 않는다. */
import {
  analysisFilterValueSchema,
  type AnalysisFilterValue
} from '@eatbid/contracts/api/v1/analysis';
import { z } from 'zod';
import type {
  AnalysisDraft,
  AnalysisDraftErrors,
  AnalysisFilterSetup
} from './analysis-filter-types';

export function draftOfAnalysis(filter: AnalysisFilterValue): AnalysisDraft {
  return {
    from: filter.period.from,
    to: filter.period.to,
    dateBasis: filter.dateBasis,
    comparisonScope: filter.comparisonScope,
    floor: filter.floorRate.value,
    awardMethod: filter.awardMethodCodeValueId,
    min: filter.listCountRange.min === null ? '' : String(filter.listCountRange.min),
    max: filter.listCountRange.max === null ? '' : String(filter.listCountRange.max),
    items: filter.itemFilter.kind === 'atoms' ? filter.itemFilter.atoms : [],
    itemUnknown: filter.itemFilter.kind === 'unknown'
      || (filter.itemFilter.kind === 'atoms' && filter.itemFilter.unknown),
    overlayOrganizationIds: filter.overlayOrganizationIds
  };
}

/**
 * 고른 품목을 DTO로 옮긴다. 아무것도 안 고른 상태가 전체이며 그때만 미확인이 함께 들어간다 —
 * 품목을 고른 사용자에게 고르지 않은 것까지 주지 않고, 고르지 않은 사용자에게서 3분의 1을 조용히
 * 빼지도 않는다(PDR-0007).
 */
function itemFilterOf(draft: AnalysisDraft): AnalysisFilterValue['itemFilter'] {
  if (draft.items.length === 0) return draft.itemUnknown ? { kind: 'unknown' } : { kind: 'all' };
  return { kind: 'atoms', atoms: [...draft.items], unknown: draft.itemUnknown };
}

function countInput(raw: string): number | null | undefined {
  if (raw.trim() === '') return null;
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= 2_147_483_647 ? value : undefined;
}

/** 이 검증은 입력 피드백이다. 실제 요청을 받는 서버가 날짜·코드·기관·권한을 독립적으로 검사해야 한다. */
export function validateAnalysisDraft(
  draft: AnalysisDraft,
  setup: AnalysisFilterSetup
):
  | { readonly state: 'valid'; readonly filter: AnalysisFilterValue }
  | { readonly state: 'invalid'; readonly errors: AnalysisDraftErrors } {
  const errors: AnalysisDraftErrors = {};
  if (!z.iso.date().safeParse(draft.from).success) errors.from = '올바른 시작일을 입력해 주세요.';
  if (!z.iso.date().safeParse(draft.to).success) errors.to = '올바른 종료일을 입력해 주세요.';
  if (!errors.from && !errors.to && draft.from > draft.to)
    errors.to = '종료일은 시작일과 같거나 늦어야 해요.';
  const min = countInput(draft.min);
  const max = countInput(draft.max);
  if (min === undefined) errors.min = '0 이상의 정수를 입력해 주세요.';
  if (max === undefined) errors.max = '0 이상의 정수를 입력해 주세요.';
  if (min != null && max != null && min > max) errors.max = '최대 명단 수는 최소 이상이어야 해요.';
  // 지역은 이 공고가 관측한 둘이 아니라 조건 사전 전체에서 고른다. 존재 확인은 서버가 하며(없는 지역은
  // 404) 화면이 자기가 아는 목록으로 막으면 다른 시군구와 비교할 길이 없어진다.
  const floorRate = setup.options.floorRates.find((value) => value.value === draft.floor);
  if (!floorRate) errors.floor = '공고의 하한율을 확인할 수 없어요.';
  const awardMethod = setup.options.awardMethods.find(
    (option) => option.codeValueId === draft.awardMethod
  );
  if (!awardMethod) errors.awardMethod = '공고의 낙찰방식을 확인할 수 없어요.';
  if (setup.targetOrganizationId === null) errors.form = '구매기관을 확인한 뒤 비교할 수 있어요.';
  if (Object.keys(errors).length > 0) return { state: 'invalid', errors };
  const parsed = analysisFilterValueSchema.safeParse({
    targetOrganizationId: setup.targetOrganizationId,
    excludeAttemptId: setup.excludeAttemptId,
    period: { from: draft.from, to: draft.to },
    dateBasis: draft.dateBasis,
    comparisonScope: draft.comparisonScope,
    floorRate,
    awardMethodCodeValueId: awardMethod?.codeValueId,
    listCountRange: { min, max },
    itemFilter: itemFilterOf(draft),
    overlayOrganizationIds: [...draft.overlayOrganizationIds]
  });
  return parsed.success
    ? { state: 'valid', filter: parsed.data }
    : { state: 'invalid', errors: { form: '입력한 비교조건을 다시 확인해 주세요.' } };
}
