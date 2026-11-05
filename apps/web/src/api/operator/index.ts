/** @module 책임: browser consumer가 쓰는 운영자 시장 자리 명령(주기·연장·회수) 공개 표면을 제공한다. */
import type {
  ExtendMarketSeatCommand,
  GrantMarketSeatCommand,
  MarketSeatCommandResult,
  RevokeMarketSeatCommand
} from '@eatbid/contracts/api/v1/operator';

import { browserRequest } from '../_transport/browser-request';
import { extendMarketSeatWith, grantMarketSeatWith, revokeMarketSeatWith } from './market-seats';

export type {
  ExtendMarketSeatCommand,
  GrantMarketSeatCommand,
  MarketSeatCommandResult,
  MarketSeatItem,
  MarketSeatReason,
  MarketSeatRejection,
  OperatorMarketSeat,
  OperatorWorkspace,
  RevokeMarketSeatCommand
} from '@eatbid/contracts/api/v1/operator';
export { AUCTION_ITEM_ATOMS, maxMarketSeatMonths, type AuctionItemAtom } from '@eatbid/contracts/api/v1/operator';
export type { OperatorMarketSeatsRead } from './market-seats';

export function grantMarketSeat(input: GrantMarketSeatCommand): Promise<MarketSeatCommandResult> {
  return grantMarketSeatWith(browserRequest, input);
}

export function extendMarketSeat(marketSeatId: string, command: ExtendMarketSeatCommand): Promise<MarketSeatCommandResult> {
  return extendMarketSeatWith(browserRequest, { marketSeatId, command });
}

export function revokeMarketSeat(marketSeatId: string, command: RevokeMarketSeatCommand): Promise<MarketSeatCommandResult> {
  return revokeMarketSeatWith(browserRequest, { marketSeatId, command });
}
