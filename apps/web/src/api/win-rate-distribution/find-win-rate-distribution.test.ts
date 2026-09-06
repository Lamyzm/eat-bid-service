import { describe, expect, test } from 'bun:test';
import {
  winRateDistributionV1Operations,
  type WinRateDistributionV1Response
} from '@eatbid/contracts/api/v1/win-rate-distribution';

import { HttpProblemError } from '../_transport/http-problem';
import type { ContractRequest } from '../_transport/request-contract';
import { findWinRateDistributionWith } from './find-win-rate-distribution';
import { isDistributionCohortNotFoundError } from './distribution-resource-error';

const validResponse: WinRateDistributionV1Response = {
  bins: [
    {
      from: { value: '90.000', unit: 'percentage-points' },
      to: { value: '90.010', unit: 'percentage-points' },
      count: 20
    }
  ],
  medianBin: null,
  modeRange: null,
  months: [],
  meta: {
    sampleCount: 20,
    item: null,
    scope: 'national',
    regionCodeValueId: null,
    organizationId: null,
    floorRate: { value: '90.000', unit: 'percentage-points' },
    awardMethod: '31',
    binWidth: { value: '0.010', unit: 'percentage-points' },
    period: { from: '2025-10', to: '2026-09' },
    buildId: null,
    sourceReleaseId: null,
    calcVersion: null,
    computedAt: null,
    coverage: null,
    regionScheme: null
  }
};

function requestDouble(implementation: (input: unknown) => Promise<unknown>): ContractRequest {
  return Object.assign(implementation, {
    isProblem: (error: unknown): error is HttpProblemError => error instanceof HttpProblemError
  }) as ContractRequest;
}

const nationalCohort = { scope: 'national', floorRate: '90.000', awardMethod: '31' } as const;

describe('낙찰률 분포 조회', () => {
  test('코호트를 operation query 계약으로 검증한 뒤 transport에 넘긴다', async () => {
    const observed: unknown[] = [];
    const response = await findWinRateDistributionWith(
      requestDouble(async (input) => {
        observed.push(input);
        return validResponse;
      }),
      { ...nationalCohort, from: '2026-09', to: '2026-09' }
    );
    expect(response).toEqual(validResponse);
    expect(observed).toEqual([
      {
        operation: winRateDistributionV1Operations.find,
        path: {},
        query: {
          scope: 'national',
          floorRate: '90.000',
          awardMethod: '31',
          from: '2026-09',
          to: '2026-09',
          binWidth: '0.010',
          granularity: 'total'
        },
        signal: undefined
      }
    ]);
  });

  test('모집단과 축의 짝이 어긋난 요청은 네트워크에 나가기 전에 끊는다', async () => {
    const request = requestDouble(async () => {
      throw new Error('이 요청은 나가면 안 된다');
    });
    await expect(findWinRateDistributionWith(request, { ...nationalCohort, regionCodeValueId: '41' }))
      .rejects.toThrow();
    await expect(findWinRateDistributionWith(request, { ...nationalCohort, scope: 'province' }))
      .rejects.toThrow();
  });

  test('없는 기관과 없는 지역 404를 화면이 다룰 수 있는 하나의 의미로 옮긴다', async () => {
    for (const code of ['ORGANIZATION_NOT_FOUND', 'NOT_FOUND'] as const) {
      const request = requestDouble(async () => {
        throw new HttpProblemError({
          type: 'https://eatbid.dev/problems/not-found',
          title: 'Resource not found',
          status: 404,
          code,
          requestId: 'test'
        });
      });
      const failure = await findWinRateDistributionWith(request, nationalCohort).catch(
        (error: unknown) => error
      );
      expect(isDistributionCohortNotFoundError(failure)).toBe(true);
    }
  });

  test('그 밖의 Problem은 원래 오류 그대로 올려 보낸다', async () => {
    const problem = new HttpProblemError({
      type: 'https://eatbid.dev/problems/dependency-unavailable',
      title: 'Dependency unavailable',
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
      requestId: 'test'
    });
    const failure = await findWinRateDistributionWith(
      requestDouble(async () => {
        throw problem;
      }),
      nationalCohort
    ).catch((error: unknown) => error);
    expect(failure).toBe(problem);
    expect(isDistributionCohortNotFoundError(failure)).toBe(false);
  });
});
