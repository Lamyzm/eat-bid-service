/** @module 책임: 하한선 자리의 세 조회(지역 목록·공고별 하한선·내 사업자 투찰)를 계약 query로 호출하고 예상된 실패를 결과 값으로 돌려준다. */
import {
  floorLineV1Operations,
  type FloorLineRegionsV1Response,
  type FloorLinesV1Response
} from '@eatbid/contracts/api/v1/analysis';
import { myFloorBidV1Operations, type MyFloorBidsV1Response } from '@eatbid/contracts/api/v1/me';
import { CODE_SCHEME_NAMES } from '@eatbid/contracts/atoms/code-scheme-names';

import type { ContractRequest } from '../_transport/request-contract';

/** 하한율·기간 창이다. 기간은 양끝 포함 KST 날짜다. */
export interface FloorLinePeriodInput {
  readonly from: string;
  readonly to: string;
  readonly floorRate: string;
}

/** 시군구 하나까지 고른 창이다. 시장 조회와 내 투찰 조회가 같은 창을 받아야 겹친 점이 같은 공고를 가리킨다. */
export interface FloorLineWindowInput extends FloorLinePeriodInput {
  readonly sigunguCodeValueId: string;
}

/** 없는 시군구는 화면이 "지역을 다시 고르라"고 말할 결과다. 표본이 없는 지역(빈 점)과 다른 사실이다. */
export type FloorLinesRead =
  | { readonly kind: 'lines'; readonly response: FloorLinesV1Response }
  | { readonly kind: 'region-not-found' };

/** 운영자가 아니면 우리 값 층이 없다는 상태다. 복기와 같은 까닭으로 예외 대신 값으로 돌려준다. */
export type MyFloorBidsRead =
  | { readonly kind: 'bids'; readonly response: MyFloorBidsV1Response }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'region-not-found' };

function windowQuery(input: FloorLineWindowInput) {
  return {
    from: input.from,
    to: input.to,
    floorRate: input.floorRate,
    regionScheme: CODE_SCHEME_NAMES.auctionLocationSigungu,
    regionCodeValueId: input.sigunguCodeValueId
  };
}

export async function findFloorLineRegionsWith(
  request: ContractRequest,
  input: FloorLinePeriodInput & { readonly signal?: AbortSignal }
): Promise<FloorLineRegionsV1Response> {
  const operation = floorLineV1Operations.findRegions;
  const query = operation.querySchema.parse({ from: input.from, to: input.to, floorRate: input.floorRate });
  return await request({ operation, path: {}, query, signal: input.signal });
}

export async function findFloorLinesWith(
  request: ContractRequest,
  input: FloorLineWindowInput & { readonly ranks: boolean; readonly signal?: AbortSignal }
): Promise<FloorLinesRead> {
  const operation = floorLineV1Operations.findFloorLines;
  const query = operation.querySchema.parse({ ...windowQuery(input), ...(input.ranks ? { include: 'ranks' } : {}) });
  try {
    return { kind: 'lines', response: await request({ operation, path: {}, query, signal: input.signal }) };
  } catch (error) {
    if (request.isProblem(error) && error.status === 404) return { kind: 'region-not-found' };
    throw error;
  }
}

export async function findMyFloorBidsWith(
  request: ContractRequest,
  input: FloorLineWindowInput & { readonly signal?: AbortSignal }
): Promise<MyFloorBidsRead> {
  const operation = myFloorBidV1Operations.findMyFloorBids;
  const query = operation.querySchema.parse(windowQuery(input));
  try {
    return { kind: 'bids', response: await request({ operation, path: undefined, query, signal: input.signal }) };
  } catch (error) {
    if (request.isProblem(error) && error.status === 403) return { kind: 'forbidden' };
    if (request.isProblem(error) && error.status === 404) return { kind: 'region-not-found' };
    throw error;
  }
}
