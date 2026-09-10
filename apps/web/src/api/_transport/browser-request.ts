/** @module 책임: browser same-origin fetch를 계약 검증 request adapter로 한 번 조립한다. */
import {
  createContractRequest,
  type ContractRequest,
  type FetchImplementation
} from './request-contract';
import { transportResilience } from './request-resilience';

export function createBrowserRequest(fetchImplementation: FetchImplementation): ContractRequest {
  return createContractRequest({
    fetch: fetchImplementation,
    resilience: transportResilience.browserRead
  });
}

// Browser는 same-origin 상대 경로만 사용하고 development proxy 또는 production ingress에 routing을 맡긴다.
// fetch를 감싸지 않고 호출 시점에 전역에서 읽어 계측 도구가 교체한 구현을 그대로 통과시킨다.
export const browserRequest = createBrowserRequest((input, init) => fetch(input, init));
