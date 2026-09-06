/** @module 책임: 낙찰률 분포 resource의 404 Problem을 화면이 다룰 수 있는 의미로 변환한다. */
import type { ContractRequest } from '../_transport/request-contract';

/**
 * 없는 기관과 없는 지역 코드값은 서버에서 다른 code로 오지만 화면이 할 일은 같다 — "이 모집단은
 * 존재하지 않는다"고 말하는 것이다. 표본이 없는 모집단(200 빈 사다리)과는 다른 사실이므로 그 둘만
 * 구분하고 두 404는 하나로 합친다.
 */
class DistributionCohortNotFoundError extends Error {
  readonly name = 'DistributionCohortNotFoundError';

  constructor(cause: unknown) {
    super('이 모집단을 찾을 수 없습니다.', { cause });
  }
}

export function mapDistributionResourceError(request: ContractRequest, error: unknown): unknown {
  if (!request.isProblem(error)) return error;
  if (error.status === 404 && (error.code === 'ORGANIZATION_NOT_FOUND' || error.code === 'NOT_FOUND')) {
    return new DistributionCohortNotFoundError(error);
  }
  return error;
}

export function isDistributionCohortNotFoundError(
  error: unknown
): error is DistributionCohortNotFoundError {
  return error instanceof DistributionCohortNotFoundError;
}
