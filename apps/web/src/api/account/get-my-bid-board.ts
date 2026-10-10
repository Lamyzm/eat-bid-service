/** @module 책임: 오늘 투찰 한 장 operation을 계약 query로 호출하고 운영자 권한 없음을 결과 값으로 돌려준다. */
import {
  myBidBoardV1Operations,
  type MyBidBoardQuery,
  type MyBidBoardV1Response
} from '@eatbid/contracts/api/v1/me';

import type { ContractRequest } from '../_transport/request-contract';

/**
 * 운영자 권한이 없다는 403은 실패가 아니라 "이 사람에게는 이 화면이 없다"는 상태다. 예외로 두면 화면 전체가 error 경계로
 * 빠지고 호출자가 status 숫자를 다시 세야 한다(추천 투찰가 조회와 같은 이유).
 */
export type MyBidBoardRead =
  | { readonly kind: 'board'; readonly response: MyBidBoardV1Response }
  | { readonly kind: 'forbidden' };

export interface MyBidBoardInput {
  readonly items?: readonly NonNullable<MyBidBoardQuery['items']>[number][];
  readonly itemUnknown?: MyBidBoardQuery['itemUnknown'];
  readonly signal?: AbortSignal;
}

export async function getMyBidBoardWith(request: ContractRequest, input: MyBidBoardInput): Promise<MyBidBoardRead> {
  const operation = myBidBoardV1Operations.getMyBidBoard;
  // 지역은 query에 없다. 서버가 저장된 관심 지역을 읽는다 — 화면이 지역을 보내 남의 시장을 펼치지 못하게 한다.
  const query = operation.querySchema.parse({
    ...(input.items === undefined ? {} : { items: [...input.items] }),
    ...(input.itemUnknown === undefined ? {} : { itemUnknown: input.itemUnknown })
  });
  try {
    return { kind: 'board', response: await request({ operation, path: undefined, query, signal: input.signal }) };
  } catch (error) {
    if (request.isProblem(error) && error.status === 403) return { kind: 'forbidden' };
    throw error;
  }
}
