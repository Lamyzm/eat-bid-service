/** @module 책임: 낙찰률 분포 캐시 항목을 mart build 전환에 맞춰 무효화한다. */
import 'server-only';

import { martCacheTag } from '@eatbid/contracts/values/cache-tag';
import { revalidateTag } from 'next/cache';

import { REVALIDATE_IMMEDIATELY } from '@/shared/lib/read-cache-life';

/** 코호트별 항목이 여럿이어도 지우는 신호는 `win_rate_distribution_monthly` build 전환 하나다. */
export function revalidateWinRateDistributionCache(): void {
  revalidateTag(martCacheTag('win_rate_distribution_monthly'), REVALIDATE_IMMEDIATELY);
}
