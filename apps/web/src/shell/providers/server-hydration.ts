/** @module 책임: RSC가 이미 읽은 server state를 브라우저 QueryClient가 그대로 이어받도록 dehydrate한 상태 하나로 옮긴다. */
import 'server-only';

import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';

export interface ServerReadEntry {
  /** 소유자는 해당 API resource의 query factory다. 이 자리에서 key를 새로 만들지 않는다. */
  readonly queryKey: readonly unknown[];
  readonly data: unknown;
}

/**
 * 요청마다 버리는 client에 답을 담아 dehydrate한다. 브라우저 정책을 만드는 `createQueryClient`를 쓰지
 * 않는 이유는 그쪽이 toast·Sentry 같은 브라우저 port를 들고 있어서다. 여기서 필요한 것은 직렬화 형식
 * 하나뿐이고, 화면 정책은 브라우저 client가 그대로 소유한다.
 *
 * 넘길 값이 없으면 `undefined`를 돌려준다. `HydrationBoundary`는 빈 상태를 그대로 통과시키므로
 * 호출자가 조건부 분기를 만들지 않아도 된다.
 */
export function dehydrateServerReads(
  entries: readonly ServerReadEntry[]
): DehydratedState | undefined {
  if (entries.length === 0) return undefined;
  const client = new QueryClient();
  for (const entry of entries) client.setQueryData(entry.queryKey, entry.data);
  return dehydrate(client);
}
