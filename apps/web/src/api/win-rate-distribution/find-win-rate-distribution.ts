/** @module 책임: 분포 코호트를 findWinRateDistribution operation 계약으로 검증하고 transport 독립 조회를 수행한다. */
import {
  winRateDistributionV1Operations,
  type OperationQueryInput,
  type WinRateDistributionV1Response
} from '@eatbid/contracts/api/v1/win-rate-distribution';

import type { ContractRequest } from '../_transport/request-contract';
import { mapDistributionResourceError } from './distribution-resource-error';

/**
 * 요청 형태를 화면 어휘로 다시 적지 않고 계약 query의 입력 타입을 그대로 쓴다. 화면이 자기 이름으로
 * 코호트를 한 번 더 정의하면 계약과 화면 중 어느 쪽이 모집단의 권위인지 알 수 없다.
 */
export type WinRateDistributionCohort = OperationQueryInput<
  typeof winRateDistributionV1Operations.find
>;

export async function findWinRateDistributionWith(
  request: ContractRequest,
  input: WinRateDistributionCohort & { readonly signal?: AbortSignal }
): Promise<WinRateDistributionV1Response> {
  const { signal, ...cohort } = input;
  // 모집단과 축의 짝이 어긋난 요청은 계약이 여기서 끊는다. 무효 요청을 서버까지 보내면 400 왕복이
  // 화면의 정상 흐름이 된다.
  const query = winRateDistributionV1Operations.find.querySchema.parse(cohort);
  try {
    return await request({
      operation: winRateDistributionV1Operations.find,
      path: {},
      query,
      signal
    });
  } catch (error) {
    throw mapDistributionResourceError(request, error);
  }
}
