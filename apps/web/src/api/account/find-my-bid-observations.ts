/** @module 책임: 내 투찰 관측 batch operation을 계약대로 호출하고 응답 계보가 요청 build와 같은지 소비 측에서 검증하며 query key용 회차 집합 identity를 소유한다. */
import {
  myBidObservationV1Operations,
  type BidObservationAttemptKey,
  type MyBidObservationsV1Response
} from '@eatbid/contracts/api/v1/me';

import type { ContractRequest } from '../_transport/request-contract';
import { BidObservationsLineageError, mapBidObservationsError } from './account-resource-error';

export interface MyBidObservationsInput {
  readonly businessId: string;
  readonly organizationId: string;
  /** 회차 이력 응답 `meta.buildId` 그대로다. 다른 build면 서버가 409로 닫고 여기서도 계보를 대조한다. */
  readonly buildId: string;
  readonly attempts: readonly BidObservationAttemptKey[];
  readonly signal?: AbortSignal;
}

/**
 * query key에 쓰는 값이다. 같은 집합을 다른 순서로 물어도 같은 cache 항목을 보게 하고, 회차 하나가
 * 바뀌면 다른 항목이 된다. 최대 200개 조합이라 문자열 하나로 두어도 key 비교 비용이 문제가 되지 않는다.
 */
export function bidObservationsIdentity(attempts: readonly BidObservationAttemptKey[]): string {
  return attempts.map((key) => `${key.attemptId}:${key.revisionId}`).toSorted().join(',');
}

export async function findMyBidObservationsWith(
  request: ContractRequest,
  input: MyBidObservationsInput
): Promise<MyBidObservationsV1Response> {
  const operation = myBidObservationV1Operations.findMyBidObservations;
  const path = operation.pathSchema.parse({ businessId: input.businessId });
  try {
    const response = await request({
      operation,
      path,
      body: {
        organizationId: input.organizationId,
        buildId: input.buildId,
        attempts: [...input.attempts]
      },
      signal: input.signal
    });
    // 서버는 다른 build면 409로 닫지만, 표와 점이 같은 계보인지는 소비 측도 한 번 더 본다. 응답의 build·기관·
    // 사업자가 요청과 다르면 화면의 표와 점이 서로 다른 계보를 한 응답처럼 보이게 된다(ADR 0034).
    if (
      response.meta.buildId !== input.buildId ||
      response.organizationId !== input.organizationId ||
      response.businessId !== path.businessId
    ) {
      throw new BidObservationsLineageError({
        requested: { buildId: input.buildId, organizationId: input.organizationId, businessId: path.businessId },
        received: { buildId: response.meta.buildId, organizationId: response.organizationId, businessId: response.businessId }
      });
    }
    return response;
  } catch (error) {
    throw mapBidObservationsError(request, error);
  }
}
