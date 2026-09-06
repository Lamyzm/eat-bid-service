import { describe, expect, test } from 'bun:test';
import {
  organizationV1Operations,
  type OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';

import {
  ContractResponseError,
  HttpProblemError,
  HttpStatusError
} from '../_transport/http-problem';
import { createContractRequest, type ContractRequest } from '../_transport/request-contract';
import { isOrganizationCursorInvalidError, isOrganizationNotFoundError } from './organization-resource-error';
import { listOrganizationAuctionAttemptsWith } from './list-auction-attempts';

const validAttempts: OrganizationAuctionAttemptsV1Response = {
  organizationId: '3101',
  attempts: [
    {
      attemptId: '5796468',
      announcedAt: '2026-09-01T00:00:00Z',
      openedAt: '2026-09-04T05:00:00Z',
      item: { codeValueId: '7', label: '축산' },
      floorRate: { value: '87.745', unit: 'percentage-points' },
      baseAmount: { amount: '2761700.00', currency: 'KRW' },
      winRate: { value: '90.309', unit: 'percentage-points' },
      secondRate: { value: '90.360', unit: 'percentage-points' },
      awardedBidRate: { value: '88.3020', unit: 'percentage-points' },
      dayFloorRate: { value: '88.0350', unit: 'percentage-points' },
      listCount: 17,
      belowDayFloorCount: 2,
      winnerSupplierPartyId: '9',
      supersedesAttemptId: null
    }
  ],
  nextCursor: null,
  meta: {
    sampleCount: 1,
    item: null,
    buildId: '501',
    sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
    calcVersion: 'mart-r1',
    computedAt: '2026-09-04T00:10:00Z',
    coverage: 'unknown',
    regionScheme: 'eat:auction-location-sigungu'
  }
};

function requestDouble(
  implementation: (input: unknown) => Promise<unknown>,
  isProblem: ContractRequest['isProblem'] = (error): error is HttpProblemError =>
    error instanceof HttpProblemError
): ContractRequest {
  return Object.assign(implementation, { isProblem }) as ContractRequest;
}

describe('기관 회차 이력 resource 조회', () => {
  test('operation과 canonical path·query 및 동일한 AbortSignal을 transport에 전달한다', async () => {
    const inputs: unknown[] = [];
    const controller = new AbortController();
    const request = requestDouble(async (input) => {
      inputs.push(input);
      return validAttempts;
    });

    await expect(
      listOrganizationAuctionAttemptsWith(request, {
        organizationId: '3101',
        item: '7',
        limit: 60,
        signal: controller.signal
      })
    ).resolves.toEqual(validAttempts);
    expect(inputs).toEqual([
      {
        operation: organizationV1Operations.listAuctionAttempts,
        path: { organizationId: '3101' },
        query: { item: '7', limit: 60 },
        signal: controller.signal
      }
    ]);
  });

  test('안전 정수보다 큰 기관 ID를 문자열 URL로 보존한다', async () => {
    for (const organizationId of ['9007199254740993', '9223372036854775807']) {
      const targets: string[] = [];
      const request = createContractRequest({
        fetch: async (input) => {
          targets.push(String(input));
          return Response.json({ ...validAttempts, organizationId }, { status: 200 });
        }
      });

      await listOrganizationAuctionAttemptsWith(request, { organizationId });
      expect(targets).toEqual([
        `/api/v1/organizations/${organizationId}/auction-attempts?limit=12`
      ]);
    }
  });

  test('canonical 양의 bigint가 아닌 기관 ID는 fetch 전에 거부한다', async () => {
    for (const organizationId of ['01', '0', '-1', '1.5', '9223372036854775808']) {
      let fetchCount = 0;
      const request = createContractRequest({
        fetch: async () => {
          fetchCount += 1;
          return Response.json(validAttempts, { status: 200 });
        }
      });

      await expect(
        listOrganizationAuctionAttemptsWith(request, { organizationId })
      ).rejects.toBeDefined();
      expect(fetchCount).toBe(0);
    }
  });

  test('잘못된 2xx 응답을 resource data로 통과시키지 않는다', async () => {
    const request = createContractRequest({
      fetch: async () => Response.json({ ...validAttempts, secret: true }, { status: 200 })
    });

    await expect(
      listOrganizationAuctionAttemptsWith(request, { organizationId: '3101' })
    ).rejects.toBeInstanceOf(ContractResponseError);
  });

  test('정확한 404 ORGANIZATION_NOT_FOUND만 기관 없음 오류로 변환한다', async () => {
    const request = createContractRequest({
      fetch: async () =>
        Response.json(
          {
            type: 'https://eatbid.dev/problems/organization-not-found',
            title: '기관을 찾을 수 없음',
            status: 404,
            code: 'ORGANIZATION_NOT_FOUND',
            requestId: 'request-404'
          },
          { status: 404 }
        )
    });

    const error = await listOrganizationAuctionAttemptsWith(request, {
      organizationId: '3101'
    }).catch((reason: unknown) => reason);
    expect(isOrganizationNotFoundError(error)).toBe(true);
    expect(error).toMatchObject({
      name: 'OrganizationNotFoundError',
      organizationId: '3101'
    });
  });

  test('cursor를 보낸 요청의 400 VALIDATION_ERROR만 커서 무효 오류로 변환한다', async () => {
    const request = createContractRequest({
      fetch: async () =>
        Response.json(
          {
            type: 'https://eatbid.dev/problems/validation-error',
            title: '기관 ID 또는 query가 유효하지 않음',
            status: 400,
            code: 'VALIDATION_ERROR',
            requestId: 'request-400'
          },
          { status: 400 }
        )
    });

    const error = await listOrganizationAuctionAttemptsWith(request, {
      organizationId: '3101',
      cursor: '1'
    }).catch((reason: unknown) => reason);
    expect(isOrganizationCursorInvalidError(error)).toBe(true);
    expect(error).toMatchObject({
      name: 'OrganizationCursorInvalidError',
      organizationId: '3101'
    });
  });

  test('cursor 없는 요청의 400 VALIDATION_ERROR는 원래 Problem으로 남는다', async () => {
    const request = createContractRequest({
      fetch: async () =>
        Response.json(
          {
            type: 'https://eatbid.dev/problems/validation-error',
            title: '기관 ID 또는 query가 유효하지 않음',
            status: 400,
            code: 'VALIDATION_ERROR',
            requestId: 'request-400'
          },
          { status: 400 }
        )
    });

    const error = await listOrganizationAuctionAttemptsWith(request, {
      organizationId: '3101',
      item: '7'
    }).catch((reason: unknown) => reason);
    expect(isOrganizationCursorInvalidError(error)).toBe(false);
    expect(error).toBeInstanceOf(HttpProblemError);
  });

  test('다른 Problem과 malformed status 및 abort 오류는 원래 typed failure를 유지한다', async () => {
    const failures = [
      new HttpProblemError({
        type: 'https://eatbid.dev/problems/dependency-unavailable',
        title: '의존성을 사용할 수 없음',
        status: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
        requestId: 'request-503'
      }),
      new HttpStatusError(500, 'request-500'),
      new DOMException('요청 취소', 'AbortError')
    ];

    for (const failure of failures) {
      const request = requestDouble(async () => {
        throw failure;
      });
      await expect(
        listOrganizationAuctionAttemptsWith(request, { organizationId: '3101' })
      ).rejects.toBe(failure);
    }
  });
});
