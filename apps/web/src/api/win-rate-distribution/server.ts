/** @module 책임: RSC에서만 쓰는 낙찰률 분포 조회와 모집단 오류 판별 표면을 제공한다. */
import 'server-only';

import type { WinRateDistributionV1Response } from '@eatbid/contracts/api/v1/win-rate-distribution';

import { serverRequest } from '../_transport/server-request.server';
import { isDistributionCohortNotFoundError } from './distribution-resource-error';
import {
  findWinRateDistributionWith,
  type WinRateDistributionCohort
} from './find-win-rate-distribution';

export function findWinRateDistributionFromServer(
  input: WinRateDistributionCohort & { readonly signal?: AbortSignal }
): Promise<WinRateDistributionV1Response> {
  return findWinRateDistributionWith(serverRequest, input);
}

export { isDistributionCohortNotFoundError };
