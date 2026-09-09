/** @module 책임: 현재 세션 상태를 getCurrentSession 계약으로 조회하는 transport 독립 read를 소유한다. */
import {
  sessionV1Operations,
  type CurrentSessionV1Response
} from '@eatbid/contracts/api/v1/session';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAccountResourceError } from './account-resource-error';

export async function getCurrentSessionWith(
  request: ContractRequest,
  input: { readonly signal?: AbortSignal } = {}
): Promise<CurrentSessionV1Response> {
  try {
    return await request({
      operation: sessionV1Operations.getCurrentSession,
      path: undefined,
      signal: input.signal
    });
  } catch (error) {
    throw mapAccountResourceError(request, error);
  }
}
