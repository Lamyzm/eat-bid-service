/** @module 책임: server runtime의 API origin과 fetch를 계약 request adapter에 지연 주입한다. */
import 'server-only';

import { readServerApiOrigin } from './api-origin';
import { createContractRequest } from './request-contract';

// 환경은 module load가 아닌 매 요청 시점에 읽어 배포 runtime 주입과 test 격리를 보존한다.
export const serverRequest = createContractRequest({
  fetch: (input, init) => fetch(input, init),
  resolveOrigin: () => readServerApiOrigin(process.env)
});

/**
 * 신선도 모드 전용이다. `use cache` 밖에서만 부르고 Next data cache에도 남기지 않는다. 바깥 `use cache`를
 * 호출한 채 안쪽 fetch만 no-store로 바꾸면 stale은 그대로라 별도 entry가 필요하다(historyRead=latest).
 */
export const uncachedServerRequest = createContractRequest({
  fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  resolveOrigin: () => readServerApiOrigin(process.env)
});
