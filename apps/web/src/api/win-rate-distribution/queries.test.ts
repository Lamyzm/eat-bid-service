import { describe, expect, test } from 'bun:test';

import { HttpProblemError } from '../_transport/http-problem';
import type { ContractRequest } from '../_transport/request-contract';
import { createWinRateDistributionQueries } from './queries';

const queries = createWinRateDistributionQueries(
  Object.assign(async () => undefined, {
    isProblem: (error: unknown): error is HttpProblemError => error instanceof HttpProblemError
  }) as unknown as ContractRequest
);

const nationalCohort = { scope: 'national', floorRate: '90.000', awardMethod: '31' } as const;

describe('낙찰률 분포 query key', () => {
  test('같은 코호트는 같은 key를 만들고 기본값도 key에 실린다', () => {
    expect(queries.distribution(nationalCohort).queryKey).toEqual(
      queries.distribution({ ...nationalCohort, binWidth: '0.010', granularity: 'total' }).queryKey
    );
    expect(queries.distribution(nationalCohort).queryKey[1]).toMatchObject({
      binWidth: '0.010',
      granularity: 'total'
    });
  });

  test('코호트의 어느 조건이 바뀌어도 key가 바뀐다', () => {
    const base = JSON.stringify(queries.distribution(nationalCohort).queryKey);
    const variants = [
      { ...nationalCohort, floorRate: '88.000' },
      { ...nationalCohort, awardMethod: '33' },
      { ...nationalCohort, from: '2026-01', to: '2026-09' },
      { ...nationalCohort, binWidth: '0.050' },
      { ...nationalCohort, granularity: 'month' },
      { ...nationalCohort, scope: 'province', regionCodeValueId: '41' },
      { ...nationalCohort, scope: 'organization', organizationId: '3101' }
    ] as const;
    for (const variant of variants) {
      expect(JSON.stringify(queries.distribution(variant).queryKey), JSON.stringify(variant))
        .not.toBe(base);
    }
  });

  test('key 뿌리는 분포 resource 하나만 가리킨다', () => {
    expect(queries.all()).toEqual(['win-rate-distribution']);
    expect(queries.distribution(nationalCohort).queryKey[0]).toBe('win-rate-distribution');
  });
});
