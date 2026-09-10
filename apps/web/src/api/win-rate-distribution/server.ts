/** @module 책임: RSC에서만 쓰는, 세션 쿠키를 실어 나르는 낙찰률 분포 조회와 모집단 오류 판별 표면을 제공한다. */
import 'server-only';

import type { WinRateDistributionV1Response } from '@eatbid/contracts/api/v1/win-rate-distribution';

import { privateServerRequest } from '../_transport/private-server-request.server';
import { isDistributionCohortNotFoundError } from './distribution-resource-error';
import {
  findWinRateDistributionWith,
  type WinRateDistributionCohort
} from './find-win-rate-distribution';

/**
 * 이 조회는 `ProviderSessionGuard`가 걸린 제품 데이터 읽기다(ADR 0032 §12). `use cache` 경계 안에서는
 * 요청 쿠키를 읽을 수 없어(ADR 0028 §4) 게이트 앞에 익명으로 닿아 항상 401을 받는다 — EAT-165가 잡은
 * 장애가 이 함수였다. `use cache`·`cacheTag`·`cacheLife`를 모두 떼고 쿠키를 그대로 실어 나르는
 * `privateServerRequest`로 세션을 전달한다(ADR 0032 §14). `cache-tags.ts`의 태그 함수와 `revalidate.ts`는
 * 걷어내지 않았으니 그 파일에서 "왜 안 불리는지"를 확인할 수 있다.
 */
export async function findWinRateDistributionFromServer(
  input: WinRateDistributionCohort
): Promise<WinRateDistributionV1Response> {
  return await findWinRateDistributionWith(privateServerRequest, input);
}

export { isDistributionCohortNotFoundError };
export { revalidateWinRateDistributionCache } from './revalidate';
