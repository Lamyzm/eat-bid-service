/** @module 책임: 저장된 조건 조합의 조회·저장·삭제·건수 query를 operation 계약으로 검증하고 transport 독립 조회를 수행한다. */
import {
  myFilterCombinationV1Operations,
  type MyFilterCombinationCountsV1Response,
  type MyFilterCombinationsV1Response,
  type MyFilterCombinationV1Response
} from '@eatbid/contracts/api/v1/me';

import type { ContractRequest } from '../_transport/request-contract';

/**
 * 건수 조회가 받는 지금 화면 조건이다. 목록·요약과 같은 atom을 쓰되 날짜 축과 cursor가 없다 — 조합은
 * 그 시점의 집합이 아니라 조건을 가리키고, 날짜로 좁힌 수를 조합 옆에 적으면 눌렀을 때와 달라진다.
 */
export type FilterCombinationCountsInput = {
  readonly sido?: string;
  readonly sigungu?: readonly string[];
  readonly eligibilityArea?: readonly string[];
  readonly items?: readonly string[];
  readonly baseAmountMin?: string;
  readonly baseAmountMax?: string;
};

export type SaveFilterCombinationInput = FilterCombinationCountsInput & { readonly name: string };

export async function listFilterCombinationsWith(
  request: ContractRequest,
  input: { readonly signal?: AbortSignal } = {}
): Promise<MyFilterCombinationsV1Response> {
  return await request({
    operation: myFilterCombinationV1Operations.listMyFilterCombinations,
    path: undefined,
    signal: input.signal
  });
}

export async function countFilterCombinationsWith(
  request: ContractRequest,
  input: FilterCombinationCountsInput & { readonly signal?: AbortSignal }
): Promise<MyFilterCombinationCountsV1Response> {
  const query = myFilterCombinationV1Operations.countMyFilterCombinations.querySchema.parse({
    sido: input.sido,
    sigungu: input.sigungu,
    eligibilityArea: input.eligibilityArea,
    items: input.items,
    baseAmountMin: input.baseAmountMin,
    baseAmountMax: input.baseAmountMax
  });
  return await request({
    operation: myFilterCombinationV1Operations.countMyFilterCombinations,
    path: undefined,
    query,
    signal: input.signal
  });
}

export async function saveFilterCombinationWith(
  request: ContractRequest,
  input: SaveFilterCombinationInput & { readonly signal?: AbortSignal }
): Promise<MyFilterCombinationV1Response> {
  const body = myFilterCombinationV1Operations.saveMyFilterCombination.bodySchema.parse({
    name: input.name,
    sido: input.sido,
    sigungu: input.sigungu,
    items: input.items,
    baseAmountMin: input.baseAmountMin,
    baseAmountMax: input.baseAmountMax
  });
  return await request({
    operation: myFilterCombinationV1Operations.saveMyFilterCombination,
    path: undefined,
    body,
    signal: input.signal
  });
}

export async function deleteFilterCombinationWith(
  request: ContractRequest,
  input: { readonly filterCombinationId: string; readonly signal?: AbortSignal }
): Promise<void> {
  await request({
    operation: myFilterCombinationV1Operations.deleteMyFilterCombination,
    path: { filterCombinationId: input.filterCombinationId },
    signal: input.signal
  });
}
