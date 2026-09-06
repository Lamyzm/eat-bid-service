/** @module 책임: 낙찰률 분포 캐시 항목에 걸 태그 집합을 계약 어휘에서 파생한다. */
import { type CacheTag, martCacheTag } from '@eatbid/contracts/values/cache-tag';

/**
 * 코호트가 캐시 키를 나누므로 태그는 코호트를 구분하지 않는다. 분포의 신선도는 코호트가 아니라
 * `win_rate_distribution_monthly` build 전환 하나가 좌우한다(ADR 0036-1).
 */
export function winRateDistributionReadCacheTags(): readonly CacheTag[] {
  return [martCacheTag('win_rate_distribution_monthly')];
}
