/** @module 책임: RSC가 요청 쿠키로 운영자 시장 자리 목록과 업체 선택지를 읽는다. 운영자 데이터라 캐시하지 않는다. */
import 'server-only';

import { privateServerRequest } from '../_transport/private-server-request.server';
import { listOperatorMarketSeatsWith, type OperatorMarketSeatsRead } from './market-seats';

export type { OperatorMarketSeatsRead };

export async function listOperatorMarketSeatsFromServer(): Promise<OperatorMarketSeatsRead> {
  return await listOperatorMarketSeatsWith(privateServerRequest);
}
