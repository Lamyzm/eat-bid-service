/** @module 책임: browser consumer가 쓰는 참가제한지역 목록·미리보기 조회와 TanStack Query 공개 표면을 제공한다. */
import { browserRequest } from '../_transport/browser-request';
import { createEligibilityAreaQueries } from './queries';

export type {
  EligibilityArea,
  EligibilityAreaGroup,
  ListEligibilityAreasV1Response,
  RegionCoverageV1Response
} from '@eatbid/contracts/api/v1/eligibility-areas';
export { eligibilityAreaQueryKeys, regionSelectionIdentity } from './queries';

export const eligibilityAreaQueries = createEligibilityAreaQueries(browserRequest);
