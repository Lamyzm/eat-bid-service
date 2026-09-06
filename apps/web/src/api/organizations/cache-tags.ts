/** @module 책임: 기관 회차 이력 캐시 항목에 걸 태그 집합을 계약 어휘에서 파생한다. */
import {
  type CacheTag,
  martCacheTag,
  organizationCacheTag
} from '@eatbid/contracts/values/cache-tag';

/**
 * 회차 이력의 신선도를 실제로 좌우하는 것은 `org_round_summary` build 전환이다. `org:<id>`는 지금
 * 아무도 지우지 않으며 기관 단위 정밀 무효화가 필요해질 때의 자리다(ADR 0036-1).
 */
export function organizationAttemptsReadCacheTags(organizationId: string): readonly CacheTag[] {
  return [organizationCacheTag(organizationId), martCacheTag('org_round_summary')];
}
