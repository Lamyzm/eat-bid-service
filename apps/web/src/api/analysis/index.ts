/** @module 책임: browser consumer가 쓰는 분석 조회의 공개 표면과 TanStack Query 항목을 제공한다. */
import { browserRequest } from '../_transport/browser-request';
import { createAnalysisQueries } from './queries';

export type {
  AnalysisComparisonSeries,
  AnalysisDensityCell,
  AnalysisMeta,
  AnalysisTargetPoint,
  AnalysisTimeSeriesAxis,
  AnalysisTimeSeriesV1Response
} from '@eatbid/contracts/api/v1/analysis';
export type {
  AnalysisFilterValue,
  AnalysisConditionOptionsV1Response,
  AnalysisItemCount,
  AnalysisOrganizationOption,
  AnalysisRegionCount
} from '@eatbid/contracts/api/v1/analysis';
export { analysisTimeSeriesQueryOf, type AnalysisTimeSeriesQueryInput } from './find-analysis-time-series';
export {
  analysisConditionOptionsQueryOf,
  type AnalysisConditionOptionsQueryInput
} from './find-analysis-condition-options';

/** 브라우저가 쓰는 조건 사전 조회다. 서버 전용 표면은 `server.ts`가 갖는다. */
export const analysisQueries = createAnalysisQueries(browserRequest);
