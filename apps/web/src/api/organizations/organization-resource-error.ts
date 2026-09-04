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
 * 서버는 잘못된 cursor와 그 밖의 query·경로 오류를 같은 400 VALIDATION_ERROR로 닫는다. 요청에
 * cursor가 실렸을 때만 cursor 문제로 좁히고, 나머지 400은 원래 Problem 그대로 올려 보낸다.
 */
export function mapOrganizationResourceError(
  request: ContractRequest,
  error: unknown,
  input: { readonly organizationId: string; readonly hasCursor: boolean }
): unknown {
  if (!request.isProblem(error)) return error;
  if (error.status === 404 && error.code === 'ORGANIZATION_NOT_FOUND') {
    return new OrganizationNotFoundError(input.organizationId, error);
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
