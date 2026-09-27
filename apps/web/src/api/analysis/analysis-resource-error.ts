/** @module 책임: 분석 resource의 404·409 Problem을 화면이 다룰 수 있는 의미로 변환한다. */
import type { ContractRequest } from '../_transport/request-contract';

/**
 * 없는 기관과 없는 지역 코드값은 서버에서 다른 code로 오지만 화면이 할 일은 같다 — "이 조건의 모집단은
 * 존재하지 않는다"고 말하고 조건을 고치게 하는 것이다. 표본이 없는 모집단(200 빈 결과)과는 다른
 * 사실이므로 그 둘만 구분하고 두 404는 하나로 합친다.
 */
class AnalysisCohortNotFoundError extends Error {
  readonly name = 'AnalysisCohortNotFoundError';

  constructor(cause: unknown) {
    super('이 조건의 모집단을 찾을 수 없습니다.', { cause });
  }
}

/**
 * 이어 읽던 이력의 기준 build가 더 이상 활성이 아니다. 화면이 할 일은 조건을 고치는 것이 아니라 처음부터
 * 다시 읽는 것이라 요청 오류(400)와 다른 뜻으로 가른다.
 */
class AnalysisSnapshotChangedError extends Error {
  readonly name = 'AnalysisSnapshotChangedError';

  constructor(cause: unknown) {
    super('분석 자료의 기준이 바뀌었습니다.', { cause });
  }
}

export function mapAnalysisResourceError(request: ContractRequest, error: unknown): unknown {
  if (!request.isProblem(error)) return error;
  if (error.status === 409) return new AnalysisSnapshotChangedError(error);
  if (
    error.status === 404 &&
    (error.code === 'ORGANIZATION_NOT_FOUND' || error.code === 'NOT_FOUND')
  ) {
    return new AnalysisCohortNotFoundError(error);
  }
  return error;
}

export function isAnalysisCohortNotFoundError(
  error: unknown
): error is AnalysisCohortNotFoundError {
  return error instanceof AnalysisCohortNotFoundError;
}

export function isAnalysisSnapshotChangedError(
  error: unknown
): error is AnalysisSnapshotChangedError {
  return error instanceof AnalysisSnapshotChangedError;
}
