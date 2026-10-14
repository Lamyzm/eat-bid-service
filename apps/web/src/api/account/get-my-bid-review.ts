/** @module 책임: 내 투찰 복기 operation을 계약 query로 호출하고 운영자 권한 없음을 결과 값으로 돌려준다. */
import { myBidReviewV1Operations, type MyBidReviewV1Response } from '@eatbid/contracts/api/v1/me';

import type { ContractRequest } from '../_transport/request-contract';

/** 운영자가 아니면 이 화면이 없다는 상태다. 오늘 투찰 조회와 같은 이유로 예외 대신 값으로 돌려준다. */
export type MyBidReviewRead =
  | { readonly kind: 'review'; readonly response: MyBidReviewV1Response }
  | { readonly kind: 'forbidden' };

export interface MyBidReviewInput {
  /** KST 달(`2026-09`)이다. 없으면 서버가 가장 최근 달을 고른다. */
  readonly month?: string;
  readonly signal?: AbortSignal;
}

export async function getMyBidReviewWith(request: ContractRequest, input: MyBidReviewInput): Promise<MyBidReviewRead> {
  const operation = myBidReviewV1Operations.getMyBidReview;
  // 손으로 고친 주소의 달이 형식에 맞지 않으면 보내지 않고 최근 달을 연다 — 400으로 화면 전체를 막지 않는다.
  const parsed = operation.querySchema.safeParse(input.month === undefined ? {} : { month: input.month });
  const query = parsed.success ? parsed.data : operation.querySchema.parse({});
  try {
    return { kind: 'review', response: await request({ operation, path: undefined, query, signal: input.signal }) };
  } catch (error) {
    if (request.isProblem(error) && error.status === 403) return { kind: 'forbidden' };
    throw error;
  }
}
