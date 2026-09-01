/** @module 책임: browser same-origin fetch를 계약 검증 request adapter로 한 번 조립한다. */
import {
  createContractRequest,
  type ContractRequest,
  type FetchImplementation
} from './request-contract';

export function createBrowserRequest(fetchImplementation: FetchImplementation): ContractRequest {
  return createContractRequest({ fetch: fetchImplementation });
}

// Browser는 same-origin 상대 경로만 사용하고 development proxy 또는 production ingress에 routing을 맡긴다.
export const browserRequest = createBrowserRequest((input, init) => fetch(input, init));
