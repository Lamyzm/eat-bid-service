/** @module 책임: browser consumer가 사용하는 낙찰률 분포 조회와 TanStack Query 공개 표면을 제공한다. */
import type { WinRateDistributionV1Response } from '@eatbid/contracts/api/v1/win-rate-distribution';

import { browserRequest } from '../_transport/browser-request';
import {
  findWinRateDistributionWith,
  type WinRateDistributionCohort
} from './find-win-rate-distribution';
import { createWinRateDistributionQueries } from './queries';

export type {
  DistributionBin,
  DistributionScope,
  WinRateDistributionMeta,
  WinRateDistributionV1Response
} from '@eatbid/contracts/api/v1/win-rate-distribution';
export type { WinRateDistributionCohort };
export { isDistributionCohortNotFoundError } from './distribution-resource-error';

export function findWinRateDistribution(
  input: WinRateDistributionCohort & { readonly signal?: AbortSignal }
): Promise<WinRateDistributionV1Response> {
  return findWinRateDistributionWith(browserRequest, input);
}

export const winRateDistributionQueries = createWinRateDistributionQueries(browserRequest);
