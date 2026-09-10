/** @module 책임: 낙찰률 분포 캐시 항목을 mart build 전환에 맞춰 무효화한다. */
import 'server-only';

import { martCacheTag } from '@eatbid/contracts/values/cache-tag';
import { revalidateTag } from 'next/cache';

import { REVALIDATE_IMMEDIATELY } from '@/shared/lib/read-cache-life';

/**
 * 코호트별 항목이 여럿이어도 지우는 신호는 `win_rate_distribution_monthly` build 전환 하나다.
 *
 * **지금은 지울 대상이 없다.** `server.ts`의 `findWinRateDistributionFromServer`가 EAT-165로
 * `use cache`를 버려서 `winRateDistributionReadCacheTags`로 태그를 거는 `use cache` 항목이 더는 생기지
 * 않는다(ADR 0032 §14). 이 함수는 `app/internal/cache/revalidate/route.ts`(dataplane push 수신
 * endpoint)가 여전히 부르므로 호출 자체는 계속되지만 `revalidateTag`가 지울 항목이 없어 사실상 no-op이다.
 * 걷어내지 않는 이유는 캐시가 다시 필요해질 때 이 자리를 그대로 쓰기 위해서이고, route의 공개 계약을
 * 같은 변경에서 지우면 dataplane 배포 순서 문제가 생기기 때문이다.
 */
export function revalidateWinRateDistributionCache(): void {
  revalidateTag(martCacheTag('win_rate_distribution_monthly'), REVALIDATE_IMMEDIATELY);
}
