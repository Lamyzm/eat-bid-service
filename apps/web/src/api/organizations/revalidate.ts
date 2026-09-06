/** @module 책임: 기관 회차 이력 캐시 항목을 mart build 전환에 맞춰 무효화한다. */
import 'server-only';

import { martCacheTag } from '@eatbid/contracts/values/cache-tag';
import { revalidateTag } from 'next/cache';

import { REVALIDATE_IMMEDIATELY } from '@/shared/lib/read-cache-life';

/**
 * 회차 이력은 `org_round_summary`가 만든 파생물이므로 build 전환 하나가 모든 기관의 항목을 지운다.
 * 기관 단위 정밀 무효화는 지우는 쪽이 기관 목록을 알게 되는 날 `org:<id>` 태그로 더한다(ADR 0036-1).
 */
export function revalidateOrgRoundSummaryCache(): void {
  revalidateTag(martCacheTag('org_round_summary'), REVALIDATE_IMMEDIATELY);
}
