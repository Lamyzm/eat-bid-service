/** @module 책임: RSC에서만 쓰는 캐시된 낙찰률 분포 조회와 모집단 오류 판별 표면을 제공한다. */
import 'server-only';

import type { WinRateDistributionV1Response } from '@eatbid/contracts/api/v1/win-rate-distribution';
import { cacheLife, cacheTag } from 'next/cache';

import { READ_CACHE_LIFE } from '@/shared/lib/read-cache-life';

import { serverRequest } from '../_transport/server-request.server';
import { winRateDistributionReadCacheTags } from './cache-tags';
import { isDistributionCohortNotFoundError } from './distribution-resource-error';
import {
  findWinRateDistributionWith,
  type WinRateDistributionCohort
} from './find-win-rate-distribution';

/**
 * 캐시 경계다. 코호트 전체가 캐시 키이므로 모집단·기간·축 조합마다 항목이 하나씩 생기고, 항목 하나는
 * 25단 남짓이라 작다. `signal`은 직렬화되지 않으므로 여기서 받지 않는다.
 */
export async function findWinRateDistributionFromServer(
  input: WinRateDistributionCohort
): Promise<WinRateDistributionV1Response> {
  'use cache';
  cacheTag(...winRateDistributionReadCacheTags());
  cacheLife(READ_CACHE_LIFE);
  return await findWinRateDistributionWith(serverRequest, input);
}

export { isDistributionCohortNotFoundError };
