import { describe, expect, test } from 'bun:test';
import { meV1Operations } from '@eatbid/contracts/api/v1/me';

import { HttpProblemError } from '../_transport/http-problem';
import type { ContractRequest } from '../_transport/request-contract';
import {
  isAccountForbiddenError,
  isAccountUnauthenticatedError,
  isBusinessNumberRejectedError,
  isRegisteredBusinessConflictError,
  isRegisteredBusinessMissingError
} from './account-resource-error';
import {
  clearMyBusinessLocationWith,
  registerMyBusinessWith,
  setMyBusinessLocationWith
} from './my-businesses';

function requestDouble(
  inputs: unknown[],
  problem?: { readonly status: number; readonly code: string }
): ContractRequest {
  return Object.assign(
    async (input: unknown) => {
      inputs.push(input);
      if (problem) {
        throw new HttpProblemError({
          type: 'about:blank',
          title: 'test',
          status: problem.status,
          code: problem.code,
          requestId: 'test-request'
        } as never);
      }
      return { business: null };
    },
    {
      isProblem: (error: unknown): error is HttpProblemError => error instanceof HttpProblemError
    }
  ) as ContractRequest;
}

describe('등록 사업자 command', () => {
  test('등록은 사용자 표기를 계약 command 그대로 보낸다', async () => {
    const inputs: unknown[] = [];
    await registerMyBusinessWith(requestDouble(inputs), { businessNumber: '124-81-00998' });

    expect(inputs).toEqual([
      expect.objectContaining({
        operation: meV1Operations.registerMyBusiness,
        body: { businessNumber: '124-81-00998' }
      })
    ]);
  });

  test('위치 저장은 businessId를 계약 path schema로 검증한다', async () => {
    const inputs: unknown[] = [];
    await setMyBusinessLocationWith(requestDouble(inputs), {
      businessId: '9007199254740993',
      addressText: '서울특별시 중구 세종대로 110'
    });

    expect(inputs).toEqual([
      expect.objectContaining({
        path: { businessId: '9007199254740993' },
        body: { addressText: '서울특별시 중구 세종대로 110' }
      })
    ]);
  });

  test('선행 0이나 음수 businessId는 요청 전에 거부한다', async () => {
    const request = requestDouble([]);

    for (const businessId of ['01', '-1', '1.5', '']) {
      expect(setMyBusinessLocationWith(request, { businessId, addressText: '주소' })).rejects.toThrow();
    }
  });

  test('위치 삭제는 별도 command이며 빈 문자열 저장이 아니다', async () => {
    const inputs: unknown[] = [];
    await clearMyBusinessLocationWith(requestDouble(inputs), { businessId: '7' });

    expect(inputs).toEqual([
      expect.objectContaining({
        operation: meV1Operations.clearMyBusinessLocation,
        path: { businessId: '7' }
      })
    ]);
  });
});

describe('계정 Problem 변환', () => {
  const cases = [
    { status: 400, code: 'VALIDATION_ERROR', matches: isBusinessNumberRejectedError },
    { status: 401, code: 'UNAUTHENTICATED', matches: isAccountUnauthenticatedError },
    { status: 403, code: 'FORBIDDEN', matches: isAccountForbiddenError },
    { status: 404, code: 'NOT_FOUND', matches: isRegisteredBusinessMissingError },
    { status: 409, code: 'CONFLICT', matches: isRegisteredBusinessConflictError }
  ];

  test('status마다 화면이 다른 행동을 고를 수 있는 오류로 나눈다', async () => {
    for (const problem of cases) {
      const request = requestDouble([], problem);
      const failure = await registerMyBusinessWith(request, { businessNumber: '1248100998' })
        .then(() => null)
        .catch((error: unknown) => error);

      expect(problem.matches(failure)).toBe(true);
    }
  });
});
