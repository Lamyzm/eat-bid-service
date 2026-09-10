/** @module 책임: 기관 회차 이력 캐시 항목을 mart build 전환에 맞춰 무효화한다. */
import 'server-only';

import { martCacheTag } from '@eatbid/contracts/values/cache-tag';
import { revalidateTag } from 'next/cache';

import { REVALIDATE_IMMEDIATELY } from '@/shared/lib/read-cache-life';

/**
 * 회차 이력은 `org_round_summary`가 만든 파생물이므로 build 전환 하나가 모든 기관의 항목을 지운다.
 * 기관 단위 정밀 무효화는 지우는 쪽이 기관 목록을 알게 되는 날 `org:<id>` 태그로 더한다(ADR 0036-1).
 *
 * **지금은 지울 대상이 없다.** `server.ts`의 `listOrganizationAuctionAttemptsFromServer`가 EAT-165로
 * `use cache`를 버려서 `organizationAttemptsReadCacheTags`로 태그를 거는 `use cache` 항목이 더는 생기지
 * 않는다(ADR 0032 §14). 이 함수는 `app/internal/cache/revalidate/route.ts`(dataplane push 수신
 * endpoint)가 여전히 부르므로 호출 자체는 계속되지만 `revalidateTag`가 지울 항목이 없어 사실상 no-op이다.
 * 걷어내지 않는 이유는 캐시가 다시 필요해질 때 이 자리를 그대로 쓰기 위해서이고, route의 공개 계약을
 * 같은 변경에서 지우면 dataplane 배포 순서 문제가 생기기 때문이다.
 */
export function revalidateOrgRoundSummaryCache(): void {
  revalidateTag(martCacheTag('org_round_summary'), REVALIDATE_IMMEDIATELY);
}
