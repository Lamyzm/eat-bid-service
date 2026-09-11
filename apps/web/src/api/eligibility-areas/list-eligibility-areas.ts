/** @module 책임: 참가제한지역 선택 목록 조회를 listEligibilityAreas operation 계약으로 수행하는 transport 독립 함수를 소유한다. */
import {
  eligibilityAreaV1Operations,
  type ListEligibilityAreasV1Response
} from '@eatbid/contracts/api/v1/eligibility-areas';

import type { ContractRequest } from '../_transport/request-contract';

export async function listEligibilityAreasWith(
  request: ContractRequest,
  input: { readonly signal?: AbortSignal } = {}
): Promise<ListEligibilityAreasV1Response> {
  return request({
    operation: eligibilityAreaV1Operations.listEligibilityAreas,
    path: undefined,
    signal: input.signal
  });
}
