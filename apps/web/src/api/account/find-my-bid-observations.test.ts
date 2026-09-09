import { describe, expect, test } from 'bun:test';
import { myBidObservationV1Operations, type MyBidObservationsV1Response } from '@eatbid/contracts/api/v1/me';

import { HttpProblemError } from '../_transport/http-problem';
import type { ContractRequest } from '../_transport/request-contract';
import {
  isAccountDependencyUnavailableError,
  isAccountForbiddenError,
  isAccountUnauthenticatedError,
  isBidObservationsBuildChangedError,
  isBidObservationsLineageError,
  isBidObservationsRejectedError,
  isRegisteredBusinessMissingError
} from './account-resource-error';
import { bidObservationsIdentity, findMyBidObservationsWith } from './find-my-bid-observations';

const response: MyBidObservationsV1Response = {
  businessId: '7',
  organizationId: '41',
  supplier: { kind: 'unobserved' },
  meta: {
    buildId: '501',
    sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
    calcVersion: 'mart-r1',
    computedAt: '2026-09-05T00:10:00Z',
    coverage: 'complete',
    regionScheme: 'eat:auction-location-sigungu'
  }
};

function requestDouble(
  inputs: unknown[],
  outcome: { readonly problem?: { readonly status: number; readonly code: string }; readonly body?: MyBidObservationsV1Response } = {}
): ContractRequest {
  return Object.assign(
    async (input: unknown) => {
      inputs.push(input);
      if (outcome.problem) {
        throw new HttpProblemError({
          type: 'about:blank',
          title: 'test',
          status: outcome.problem.status,
          code: outcome.problem.code,
          requestId: 'test-request'
        } as never);
      }
      return outcome.body ?? response;
    },
    {
      isProblem: (error: unknown): error is HttpProblemError => error instanceof HttpProblemError
    }
  ) as ContractRequest;
}

const input = {
  businessId: '7',
  organizationId: '41',
  buildId: '501',
  attempts: [
    { attemptId: '8101', revisionId: '9101' },
    { attemptId: '8102', revisionId: '9102' }
  ]
};

describe('내 투찰 관측 batch 조회', () => {
  test('계약 경로·본문으로 한 번 요청하고 응답 계보가 요청 build와 같아야 받아들인다', async () => {
    const inputs: unknown[] = [];
    const result = await findMyBidObservationsWith(requestDouble(inputs), input);

    expect(result).toBe(response);
    expect(inputs).toEqual([
      expect.objectContaining({
        operation: myBidObservationV1Operations.findMyBidObservations,
        path: { businessId: '7' },
        body: { organizationId: '41', buildId: '501', attempts: input.attempts }
      })
    ]);
  });

  test('응답 build가 요청과 다르면 표와 점이 다른 계보를 말하므로 거부한다', async () => {
    const stale = { ...response, meta: { ...response.meta, buildId: '502' } };
    const error = await findMyBidObservationsWith(requestDouble([], { body: stale }), input).catch((cause) => cause);
    expect(isBidObservationsLineageError(error)).toBe(true);
  });

  test('409는 build 전환, 400은 회차 조합 거부, 401·403·404·503은 계정 오류로 번역한다', async () => {
    const cases = [
      [409, 'CONFLICT', isBidObservationsBuildChangedError],
      [400, 'VALIDATION_ERROR', isBidObservationsRejectedError],
      [401, 'UNAUTHENTICATED', isAccountUnauthenticatedError],
      [403, 'FORBIDDEN', isAccountForbiddenError],
      [404, 'NOT_FOUND', isRegisteredBusinessMissingError],
      [503, 'DEPENDENCY_UNAVAILABLE', isAccountDependencyUnavailableError]
    ] as const;
    for (const [status, code, matches] of cases) {
      const error = await findMyBidObservationsWith(requestDouble([], { problem: { status, code } }), input).catch((cause) => cause);
      expect(matches(error), `${status}`).toBe(true);
    }
  });

  test('회차 조합 identity는 순서와 무관하게 같고 조합이 하나라도 다르면 다르다', () => {
    const forward = bidObservationsIdentity([{ attemptId: '2', revisionId: '9' }, { attemptId: '1', revisionId: '8' }]);
    const backward = bidObservationsIdentity([{ attemptId: '1', revisionId: '8' }, { attemptId: '2', revisionId: '9' }]);
    expect(forward).toBe(backward);
    expect(bidObservationsIdentity([{ attemptId: '1', revisionId: '8' }, { attemptId: '2', revisionId: '10' }])).not.toBe(forward);
  });
});
