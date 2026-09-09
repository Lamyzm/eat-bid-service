/** @module 책임: server runtime의 API origin과 fetch를 계약 request adapter에 지연 주입한다. */
import 'server-only';

import { readServerApiOrigin } from './api-origin';
import { createContractRequest } from './request-contract';

// 환경은 module load가 아닌 매 요청 시점에 읽어 배포 runtime 주입과 test 격리를 보존한다.
export const serverRequest = createContractRequest({
  fetch: (input, init) => fetch(input, init),
  resolveOrigin: () => readServerApiOrigin(process.env)
});
