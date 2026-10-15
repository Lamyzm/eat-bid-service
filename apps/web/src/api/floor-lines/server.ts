/** @module 책임: RSC에서만 쓰는, 세션 쿠키를 실어 나르는 하한선 자리 세 조회를 예상된 실패까지 결과 값으로 돌려준다. */
import 'server-only';

import type { FloorLineRegionsV1Response } from '@eatbid/contracts/api/v1/analysis';

import { privateServerRequest } from '../_transport/private-server-request.server';
import {
  findFloorLineRegionsWith,
  findFloorLinesWith,
  findMyFloorBidsWith,
  type FloorLinePeriodInput,
  type FloorLinesRead,
  type FloorLineWindowInput,
  type MyFloorBidsRead
} from './floor-lines';

/**
 * 셋 다 로그인 게이트를 지나는 제품 데이터 읽기라 쿠키를 실어 나르는 `privateServerRequest`를 쓴다(ADR 0032 §12). `use cache`
 * 경계에서는 요청 쿠키를 읽을 수 없어 게이트 앞에서 익명으로 401을 받는다.
 *
 * 장애를 값으로 돌려주는 이유는 분석 조회와 같다 — 그림 하나를 못 그린 일이 화면 전체가 사라지는 일이 되면 안 된다.
 */
export type FloorLineRegionsRead =
  | { readonly kind: 'regions'; readonly response: FloorLineRegionsV1Response }
  | { readonly kind: 'read-failed' };

export async function findFloorLineRegionsFromServer(input: FloorLinePeriodInput): Promise<FloorLineRegionsRead> {
  try {
    return { kind: 'regions', response: await findFloorLineRegionsWith(privateServerRequest, input) };
  } catch (error) {
    if (privateServerRequest.isUpstreamUnavailable(error)) return { kind: 'read-failed' };
    throw error;
  }
}

export async function findFloorLinesFromServer(
  input: FloorLineWindowInput & { readonly ranks: boolean }
): Promise<FloorLinesRead | { readonly kind: 'read-failed' }> {
  try {
    return await findFloorLinesWith(privateServerRequest, input);
  } catch (error) {
    if (privateServerRequest.isUpstreamUnavailable(error)) return { kind: 'read-failed' };
    throw error;
  }
}

export async function findMyFloorBidsFromServer(
  input: FloorLineWindowInput
): Promise<MyFloorBidsRead | { readonly kind: 'read-failed' }> {
  try {
    return await findMyFloorBidsWith(privateServerRequest, input);
  } catch (error) {
    if (privateServerRequest.isUpstreamUnavailable(error)) return { kind: 'read-failed' };
    throw error;
  }
}

export type { FloorLinesRead, MyFloorBidsRead };
