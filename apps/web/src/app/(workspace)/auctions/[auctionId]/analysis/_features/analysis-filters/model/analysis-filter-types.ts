/** @module 책임: 공통 분석 DTO와 편집 중인 폼 문자열 사이의 표시 상태 경계를 정의한다. */
import type { AuctionItemAtom } from '@eatbid/contracts/api/v1/auctions';
import type {
  AnalysisFilterOptions,
  AnalysisFilterValue,
  AnalysisPeriod
} from '@eatbid/contracts/api/v1/analysis';

export type AnalysisDraft = {
  readonly from: string;
  readonly to: string;
  readonly dateBasis: AnalysisFilterValue['dateBasis'];
  readonly comparisonScope: AnalysisFilterValue['comparisonScope'];
  readonly floor: string;
  readonly awardMethod: string;
  readonly min: string;
  readonly max: string;
  /**
   * 고른 품목이다. 원자 여덟과 `품목 미확인`이 한 목록에 있고, **빈 배열이 전체**다. 미확인을 아홉째
   * 원자로 두지 않는 이유는 어휘와 같다 — 그러면 "미확인을 관측했다"와 "아무것도 관측하지 못했다"가
   * 같은 모양이 된다(EAT-230 §4.3).
   */
  readonly items: readonly AuctionItemAtom[];
  readonly itemUnknown: boolean;
};
export type AnalysisTextField = Exclude<keyof AnalysisDraft, 'comparisonScope' | 'items' | 'itemUnknown'>;
export type AnalysisDraftErrors = Partial<Record<keyof AnalysisDraft | 'form', string>>;
export type AnalysisPreset = {
  readonly value: string;
  readonly label: string;
  readonly period: AnalysisPeriod | null;
};
export type AnalysisFilterSetup = {
  readonly targetOrganizationId: string | null;
  readonly excludeAttemptId: string;
  readonly organizationLabel: string;
  /** 현재 공고에서 관측한 선택지만 담는다. 코드 사전의 활성 상태나 분석 가능성의 증명이 아니다. */
  readonly options: Pick<
    AnalysisFilterOptions,
    'floorRates' | 'awardMethods' | 'availablePeriods'
  > & {
    readonly regions: readonly Omit<
      AnalysisFilterOptions['regions'][number],
      'active' | 'parentCodeValueId'
    >[];
  };
  readonly presets: readonly AnalysisPreset[];
  readonly initialDraft: AnalysisDraft;
};
export type AppliedAnalysis =
  | { readonly state: 'invalid'; readonly key: string | null; readonly message: string }
  | {
      readonly state: 'pending';
      readonly key: string | null;
      readonly filter: AnalysisFilterValue;
    };
