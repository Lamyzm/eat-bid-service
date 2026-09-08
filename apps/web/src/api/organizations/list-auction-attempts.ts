/** @module 책임: 기관 ID와 회차 조회 query를 organizations listAuctionAttempts operation 계약으로 검증하고 transport 독립 조회를 수행한다. */
import {
  organizationV1Operations,
  type OrganizationAuctionAttemptsQuery,
  type OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';

import type { ContractRequest } from '../_transport/request-contract';
import { mapOrganizationResourceError } from './organization-resource-error';

/** operation query를 재사용해 필터가 wrapper마다 누락되거나 다른 의미로 정의되지 않게 한다. */
export interface OrganizationAttemptsReadInput extends OrganizationAuctionAttemptsQuery {
  readonly organizationId: string;
  readonly signal?: AbortSignal;
}

export async function listOrganizationAuctionAttemptsWith(
  request: ContractRequest,
  input: OrganizationAttemptsReadInput
): Promise<OrganizationAuctionAttemptsV1Response> {
  const { organizationId, signal, ...queryInput } = input;
  const path = organizationV1Operations.listAuctionAttempts.pathSchema.parse({
    organizationId
  });
  const query = organizationV1Operations.listAuctionAttempts.querySchema.parse(queryInput);
  try {
    const response = await request({
      operation: organizationV1Operations.listAuctionAttempts,
      path,
      query,
      signal
    });
    // 배포가 엇갈려 구버전 서버가 새 query를 무시하면 다른 집단을 같은 조건으로 오인한다.
    // 정확값은 계약이 보장하는 canonical 문자열로 비교해 비율이나 ID의 정밀도를 잃지 않는다.
    if (query.floorRate !== undefined || query.awardMethod !== undefined || query.from !== undefined || query.to !== undefined) {
      const cohort = response.meta.cohort;
      const floor = cohort?.floorRate.kind === 'exact' ? cohort.floorRate.value.value : cohort?.floorRate.kind;
      const method = cohort?.awardMethod.kind === 'exact' ? cohort.awardMethod.codeValueId : cohort?.awardMethod.kind;
      if (!cohort
        || (query.floorRate !== undefined && query.floorRate !== floor)
        || (query.awardMethod !== undefined && query.awardMethod !== method)
        || (query.from !== undefined && query.from !== cohort.period?.from)
        || (query.to !== undefined && query.to !== cohort.period?.to)) {
        throw new Error('요청한 비교 조건의 적용 여부를 확인할 수 없습니다.');
      }
    }
    return response;
  } catch (error) {
    throw mapOrganizationResourceError(request, error, {
      organizationId: path.organizationId,
      hasCursor: query.cursor !== undefined
    });
  }
}
