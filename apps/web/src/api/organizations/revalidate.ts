/** @module 책임: dataplane push가 부르는 `org_round_summary` mart 캐시 무효화를 소유한다. */
import 'server-only';

import { martCacheTag } from '@eatbid/contracts/values/cache-tag';
import { revalidateTag } from 'next/cache';

import { REVALIDATE_IMMEDIATELY } from '@/shared/lib/read-cache-life';

/**
 * `org_round_summary` build 전환 하나가 이 mart에서 파생한 캐시 항목 전부를 지운다(ADR 0036-1).
 *
 * **지금은 지울 대상이 없다.** 이 mart를 `use cache`로 읽던 조회는 EAT-165에서 캐시를 버렸고, 옛 공고
 * 상세와 함께 조회 자체가 사라졌다(EAT-224). 그래도 dataplane은 build 전환마다 이 mart 이름으로
 * `app/internal/cache/revalidate/route.ts`에 push하므로 함수는 남는다. 지우면 route가 그 push에 500으로 답하고,
 * route·계약·dataplane을 함께 바꾸는 일은 배포 순서를 맞춰야 하는 별도 변경이다.
 */
export function revalidateOrgRoundSummaryCache(): void {
  revalidateTag(martCacheTag('org_round_summary'), REVALIDATE_IMMEDIATELY);
}
