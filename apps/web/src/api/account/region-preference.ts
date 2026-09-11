/** @module 책임: 워크스페이스 관심 지역 조회와 통째 교체를 계약대로 수행하는 transport 독립 함수를 소유한다. */
import {
  myRegionPreferenceV1Operations,
  type MyRegionPreferenceV1Response
} from '@eatbid/contracts/api/v1/me';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAccountResourceError } from './account-resource-error';

export async function getMyRegionPreferenceWith(
  request: ContractRequest,
  input: { readonly signal?: AbortSignal } = {}
): Promise<MyRegionPreferenceV1Response> {
  try {
    return await request({
      operation: myRegionPreferenceV1Operations.getMyRegionPreference,
      path: undefined,
      signal: input.signal
    });
  } catch (error) {
    throw mapAccountResourceError(request, error);
  }
}

/**
 * 부분 갱신 command가 없으므로 화면은 언제나 최종 목록 전체를 보낸다. 확인 도장은 이 요청이 성공할 때
 * 찍히며, 빈 목록도 "지역으로 좁히지 않겠다"는 확인된 선택이라 그대로 보낸다.
 */
export async function putMyRegionPreferenceWith(
  request: ContractRequest,
  input: { readonly codeValueIds: readonly string[]; readonly signal?: AbortSignal }
): Promise<MyRegionPreferenceV1Response> {
  try {
    return await request({
      operation: myRegionPreferenceV1Operations.putMyRegionPreference,
      path: undefined,
      body: { codeValueIds: [...input.codeValueIds] },
      signal: input.signal
    });
  } catch (error) {
    throw mapAccountResourceError(request, error);
  }
}
