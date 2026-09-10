/** @module 책임: server runtime의 API origin과 fetch를 계약 request adapter에 지연 주입한다. */
import 'server-only';

import { readServerApiOrigin } from './api-origin';
import { createContractRequest } from './request-contract';
import { transportResilience } from './request-resilience';

// 환경은 module load가 아닌 매 요청 시점에 읽어 배포 runtime 주입과 test 격리를 보존한다.
// fetch도 같은 이유로 호출 시점에 전역에서 읽는다. Next가 감싼 fetch를 잡아 두면 캐시와 계측이 죽는다.
export const serverRequest = createContractRequest({
  fetch: (input, init) => fetch(input, init),
  resolveOrigin: () => readServerApiOrigin(process.env),
  resilience: transportResilience.publicServerRead
});
