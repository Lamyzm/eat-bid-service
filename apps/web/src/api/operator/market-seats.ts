/** @module 책임: 운영자 시장 자리 목록·업체 선택지 조회와 주기·연장·회수 명령을 operation 계약으로 검증하고 transport 독립으로 수행한다. */
import {
  operatorMarketSeatV1Operations,
  type ExtendMarketSeatCommand,
  type GrantMarketSeatCommand,
  type MarketSeatCommandResult,
  type OperatorMarketSeatsV1Response,
  type OperatorWorkspacesV1Response,
  type RevokeMarketSeatCommand
} from '@eatbid/contracts/api/v1/operator';

import type { ContractRequest } from '../_transport/request-contract';

const operations = operatorMarketSeatV1Operations;

/** 운영자 권한이 없으면 서버가 403을 낸다. 화면은 그것을 장애가 아니라 "볼 수 없음"으로 그린다. */
export type OperatorMarketSeatsRead =
  | { readonly kind: 'seats'; readonly seats: OperatorMarketSeatsV1Response; readonly workspaces: OperatorWorkspacesV1Response }
  | { readonly kind: 'forbidden' };

export async function listOperatorMarketSeatsWith(
  request: ContractRequest,
  input: { readonly signal?: AbortSignal } = {}
): Promise<OperatorMarketSeatsRead> {
  try {
    const [seats, workspaces] = await Promise.all([
      request({ operation: operations.listOperatorMarketSeats, path: undefined, signal: input.signal }),
      request({ operation: operations.listOperatorWorkspaces, path: undefined, signal: input.signal })
    ]);
    return { kind: 'seats', seats, workspaces };
  } catch (error) {
    if (request.isProblem(error) && error.status === 403) return { kind: 'forbidden' };
    throw error;
  }
}

export async function grantMarketSeatWith(request: ContractRequest, input: GrantMarketSeatCommand): Promise<MarketSeatCommandResult> {
  return await request({
    operation: operations.grantMarketSeat,
    path: undefined,
    body: operations.grantMarketSeat.bodySchema.parse(input)
  });
}

export async function extendMarketSeatWith(
  request: ContractRequest,
  input: { readonly marketSeatId: string; readonly command: ExtendMarketSeatCommand }
): Promise<MarketSeatCommandResult> {
  return await request({
    operation: operations.extendMarketSeat,
    path: { marketSeatId: input.marketSeatId },
    body: operations.extendMarketSeat.bodySchema.parse(input.command)
  });
}

export async function revokeMarketSeatWith(
  request: ContractRequest,
  input: { readonly marketSeatId: string; readonly command: RevokeMarketSeatCommand }
): Promise<MarketSeatCommandResult> {
  return await request({
    operation: operations.revokeMarketSeat,
    path: { marketSeatId: input.marketSeatId },
    body: operations.revokeMarketSeat.bodySchema.parse(input.command)
  });
}
