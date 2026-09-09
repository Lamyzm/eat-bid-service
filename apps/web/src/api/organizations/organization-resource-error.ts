/** @module 책임: 기관 회차 이력 resource의 404·400 Problem을 화면이 다룰 수 있는 의미로 변환한다. */
import type { ContractRequest } from '../_transport/request-contract';

class OrganizationNotFoundError extends Error {
  readonly name = 'OrganizationNotFoundError';

  constructor(
    readonly organizationId: string,
    cause: unknown
  ) {
    super('기관을 찾을 수 없습니다.', { cause });
  }
}

class OrganizationCursorInvalidError extends Error {
  readonly name = 'OrganizationCursorInvalidError';

  constructor(
    readonly organizationId: string,
    cause: unknown
  ) {
    super('요청한 커서가 이 기관의 회차 이력에 유효하지 않습니다.', { cause });
  }
}

/**
 * 이어 읽기를 고정한 build가 그 사이 활성에서 내려갔다. 요청을 고쳐서 되는 일이 아니라 누적 목록과 그 위의
 * 개인 결과를 함께 버리고 처음부터 다시 조회해야 하는 사실이다(ADR 0034).
 */
class OrganizationBuildChangedError extends Error {
  readonly name = 'OrganizationBuildChangedError';

  constructor(
    readonly organizationId: string,
    cause: unknown
  ) {
    super('고정을 요청한 자료 기준이 더 이상 활성이 아닙니다.', { cause });
  }
}

/**
 * 서버는 잘못된 cursor와 그 밖의 query·경로 오류를 같은 400 VALIDATION_ERROR로 닫는다. 요청에
 * cursor가 실렸을 때만 cursor 문제로 좁히고, 나머지 400은 원래 Problem 그대로 올려 보낸다.
 */
export function mapOrganizationResourceError(
  request: ContractRequest,
  error: unknown,
  input: { readonly organizationId: string; readonly hasCursor: boolean; readonly hasBuildPin: boolean }
): unknown {
  if (!request.isProblem(error)) return error;
  if (error.status === 404 && error.code === 'ORGANIZATION_NOT_FOUND') {
    return new OrganizationNotFoundError(input.organizationId, error);
  }
  // build 고정을 보낸 요청에서만 409를 전환으로 읽는다. 다른 409는 계약에 없으므로 그대로 올린다.
  if (input.hasBuildPin && error.status === 409 && error.code === 'CONFLICT') {
    return new OrganizationBuildChangedError(input.organizationId, error);
  }
  if (input.hasCursor && error.status === 400 && error.code === 'VALIDATION_ERROR') {
    return new OrganizationCursorInvalidError(input.organizationId, error);
  }
  return error;
}

export function isOrganizationNotFoundError(error: unknown): error is OrganizationNotFoundError {
  return error instanceof OrganizationNotFoundError;
}

export function isOrganizationCursorInvalidError(
  error: unknown
): error is OrganizationCursorInvalidError {
  return error instanceof OrganizationCursorInvalidError;
}

export function isOrganizationBuildChangedError(
  error: unknown
): error is OrganizationBuildChangedError {
  return error instanceof OrganizationBuildChangedError;
}
