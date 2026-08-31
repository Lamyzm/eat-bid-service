import 'server-only';

import { readServerApiOrigin } from './api-origin';
import { createContractRequest } from './request-contract';

// 환경은 module load가 아닌 매 요청 시점에 읽어 배포 runtime 주입과 test 격리를 보존한다.
export const serverRequest = createContractRequest({
  fetch: (input, init) => fetch(input, init),
  resolveOrigin: () => readServerApiOrigin(process.env)
});
