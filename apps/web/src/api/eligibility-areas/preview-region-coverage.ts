/** @module 책임: 저장 전 지역 선택의 공고 적용 결과 조회를 previewRegionCoverage operation 계약으로 수행한다. */
import {
  eligibilityAreaV1Operations,
  type RegionCoverageV1Response
} from '@eatbid/contracts/api/v1/eligibility-areas';

import type { ContractRequest } from '../_transport/request-contract';

/**
 * 아직 저장하지 않은 선택으로 묻기 때문에 워크스페이스의 저장값을 읽지 않고 코드 목록을 그대로 보낸다.
 * 저장 뒤에만 미리볼 수 있으면 "저장 전에 결과를 먼저 보여 준다"는 화면의 약속이 성립하지 않는다.
 */
export async function previewRegionCoverageWith(
  request: ContractRequest,
  input: { readonly codeValueIds: readonly string[]; readonly signal?: AbortSignal }
): Promise<RegionCoverageV1Response> {
  return request({
    operation: eligibilityAreaV1Operations.previewRegionCoverage,
    path: undefined,
    body: { codeValueIds: [...input.codeValueIds] },
    signal: input.signal
  });
}
