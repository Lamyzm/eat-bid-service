/** @module 책임: 계정 초기화 command를 계약대로 보내고 실패를 재시도 가능한 의미로 올린다. */
import {
  meV1Operations,
  type AccountInitializationV1Response
} from '@eatbid/contracts/api/v1/me';

import type { ContractRequest } from '../_transport/request-contract';
import { mapAccountResourceError } from './account-resource-error';

/**
 * 이 command는 명시적 사용자 행동에서만 호출한다. 렌더나 GET 경로에서 부르면 둘러보기만 한 방문자에게도
 * 워크스페이스가 쌓이고, 안전해야 할 조회가 행을 만든다(ADR 0032 §5·§8). 몇 번을 불러도 같은 결과이므로
 * 실패한 초기화의 복구 경로는 같은 command를 다시 부르는 것이다.
 */
export async function initializeCurrentAccountWith(
  request: ContractRequest,
  input: { readonly signal?: AbortSignal } = {}
): Promise<AccountInitializationV1Response> {
  try {
    return await request({
      operation: meV1Operations.initializeCurrentAccount,
      path: undefined,
      signal: input.signal
    });
  } catch (error) {
    throw mapAccountResourceError(request, error);
  }
}
