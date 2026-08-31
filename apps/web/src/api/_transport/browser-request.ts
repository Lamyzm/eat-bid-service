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
