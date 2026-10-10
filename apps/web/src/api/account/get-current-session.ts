/** @module 책임: 현재 세션 상태를 getCurrentSession 계약으로 조회하는 transport 독립 read를 소유한다. */
import {
  sessionV1Operations,
  type CurrentSessionV1Response
} from '@eatbid/contracts/api/v1/session';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAccountResourceError } from './account-resource-error';

/**
 * 운영자 여부는 요청할 때만 실린다. 게이트·메뉴를 판정하는 서버 읽기만 요청하고, 브라우저의 계정 허브는 요청하지 않는다 — 허브는
 * 그 값을 쓰지 않는다. 옛 server는 이 요청을 무시하고 값을 싣지 않으며, 그때는 운영자가 아니라고 읽는다.
 */
export async function getCurrentSessionWith(
  request: ContractRequest,
  input: { readonly signal?: AbortSignal; readonly includeOperator?: boolean } = {}
): Promise<CurrentSessionV1Response> {
  try {
    return await request({
      operation: sessionV1Operations.getCurrentSession,
      path: undefined,
      ...(input.includeOperator === true ? { query: { include: 'operator' } } : {}),
      signal: input.signal
    });
  } catch (error) {
    throw mapAccountResourceError(request, error);
  }
}
