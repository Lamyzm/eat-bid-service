/** @module 책임: 계정 계약의 Problem status를 화면이 다른 행동으로 나눌 수 있는 의미로 변환한다. */
import type { ContractRequest } from '../_transport/request-contract';

/**
 * 401과 403을 한 오류로 합치지 않는다. 401은 "다시 로그인하라"이고 403은 세션은 살아 있는데 이 요청이
 * 허용되지 않는다는 뜻이라 재로그인이 답이 아니다. 어느 쪽인지는 세션 조회 상태가 말한다(ADR 0032 §6).
 */
class AccountUnauthenticatedError extends Error {
  readonly name = 'AccountUnauthenticatedError';

  constructor(cause: unknown) {
    super('로그인이 필요합니다. 세션이 만료됐을 수 있습니다.', { cause });
  }
}

class AccountForbiddenError extends Error {
  readonly name = 'AccountForbiddenError';

  constructor(cause: unknown) {
    super('이 작업이 허용되지 않았습니다. 계정 초기화 또는 권한을 확인해 주세요.', { cause });
  }
}

class BusinessNumberRejectedError extends Error {
  readonly name = 'BusinessNumberRejectedError';

  constructor(cause: unknown) {
    super('사업자등록번호 형식이 올바르지 않습니다.', { cause });
  }
}

class RegisteredBusinessConflictError extends Error {
  readonly name = 'RegisteredBusinessConflictError';

  constructor(cause: unknown) {
    super('이미 등록된 사업자이거나 등록 가능한 수를 넘었습니다.', { cause });
  }
}

class RegisteredBusinessMissingError extends Error {
  readonly name = 'RegisteredBusinessMissingError';

  constructor(cause: unknown) {
    super('등록된 사업자를 찾을 수 없습니다. 목록을 새로 불러오세요.', { cause });
  }
}

/**
 * 인증 설정이 없거나 데이터베이스가 닫힌 배포는 "로그인하지 않음"이나 "등록이 없음"과 다른 사실이다.
 * 이 둘을 섞으면 화면이 "로그인하면 된다"고 안내하지만 로그인 자체가 불가능하다(ADR 0032 §1).
 */
class AccountDependencyUnavailableError extends Error {
  readonly name = 'AccountDependencyUnavailableError';

  constructor(cause: unknown) {
    super('인증 또는 데이터베이스 의존성을 지금 사용할 수 없습니다.', { cause });
  }
}

/**
 * 내 투찰 조회는 요청을 고쳐서 풀리는 실패와 목록 전체를 다시 읽어야 하는 실패를 나눈다. 409는 후자이며
 * 자동 재시도로 풀리지 않는다 — 회차 이력과 같은 새 build를 읽는 복구 경로가 답이다(ADR 0034).
 */
class BidObservationsBuildChangedError extends Error {
  readonly name = 'BidObservationsBuildChangedError';

  constructor(cause: unknown) {
    super('자료 기준이 바뀌어 내 투찰을 다시 불러와야 합니다.', { cause });
  }
}

class BidObservationsRejectedError extends Error {
  readonly name = 'BidObservationsRejectedError';

  constructor(cause: unknown) {
    super('요청한 회차 조합을 이 자료 기준에서 찾지 못했습니다.', { cause });
  }
}

/** 응답 계보가 요청과 다르면 표와 점이 서로 다른 계보를 한 응답처럼 보이게 된다. 서버 결함이라 재시도하지 않는다. */
class BidObservationsLineageError extends Error {
  readonly name = 'BidObservationsLineageError';

  constructor(readonly lineage: { readonly requested: Record<string, string>; readonly received: Record<string, string | null> }) {
    super('내 투찰 응답의 자료 기준이 요청과 다릅니다.');
  }
}

export function mapBidObservationsError(request: ContractRequest, error: unknown): unknown {
  if (!request.isProblem(error)) return error;
  if (error.status === 409) return new BidObservationsBuildChangedError(error);
  if (error.status === 400) return new BidObservationsRejectedError(error);
  return mapAccountResourceError(request, error);
}

export function isBidObservationsBuildChangedError(error: unknown): error is BidObservationsBuildChangedError {
  return error instanceof BidObservationsBuildChangedError;
}

export function isBidObservationsRejectedError(error: unknown): error is BidObservationsRejectedError {
  return error instanceof BidObservationsRejectedError;
}

export function isBidObservationsLineageError(error: unknown): error is BidObservationsLineageError {
  return error instanceof BidObservationsLineageError;
}

export { BidObservationsLineageError };

export function mapAccountResourceError(request: ContractRequest, error: unknown): unknown {
  if (!request.isProblem(error)) return error;
  if (error.status === 401) return new AccountUnauthenticatedError(error);
  if (error.status === 403) return new AccountForbiddenError(error);
  if (error.status === 400) return new BusinessNumberRejectedError(error);
  if (error.status === 404) return new RegisteredBusinessMissingError(error);
  if (error.status === 409) return new RegisteredBusinessConflictError(error);
  if (error.status === 503) return new AccountDependencyUnavailableError(error);
  return error;
}

export function isAccountUnauthenticatedError(error: unknown): error is AccountUnauthenticatedError {
  return error instanceof AccountUnauthenticatedError;
}

export function isAccountForbiddenError(error: unknown): error is AccountForbiddenError {
  return error instanceof AccountForbiddenError;
}

export function isBusinessNumberRejectedError(error: unknown): error is BusinessNumberRejectedError {
  return error instanceof BusinessNumberRejectedError;
}

export function isRegisteredBusinessConflictError(
  error: unknown
): error is RegisteredBusinessConflictError {
  return error instanceof RegisteredBusinessConflictError;
}

export function isRegisteredBusinessMissingError(
  error: unknown
): error is RegisteredBusinessMissingError {
  return error instanceof RegisteredBusinessMissingError;
}

export function isAccountDependencyUnavailableError(
  error: unknown
): error is AccountDependencyUnavailableError {
  return error instanceof AccountDependencyUnavailableError;
}
