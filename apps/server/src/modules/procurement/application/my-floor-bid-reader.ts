/**
 * @module 책임: 하한선 자리에 겹칠 내 사업자 투찰(값·결과·등수) 조회 port와 그 레코드를 정의한다.
 *
 * 복기처럼 읽기 스냅샷 handle을 받는다. 등록 사업자 목록과 투찰을 한 스냅샷에서 읽어야, 그 사이에 등록이 바뀌어 남의 사업자
 * 투찰이 섞이거나 내 투찰이 빠지는 일이 없다.
 */
import type { BaseRelativeBidRate } from "@eatbid/domain";

import type { TransactionHandle } from "../../../platform/database/unit-of-work";
import type { FloorLineWindow } from "./floor-line-reader";

export type MyFloorBidOutcome =
  | { readonly kind: "below-floor" }
  | { readonly kind: "valid"; readonly rank: number; readonly validBidderCount: number; readonly won: boolean };

export interface MyFloorBidRecord {
  readonly attemptId: bigint;
  readonly supplierPartyId: bigint;
  readonly supplierName: string | null;
  readonly rate: BaseRelativeBidRate;
  readonly outcome: MyFloorBidOutcome;
}

export interface MyFloorBidReader {
  readBids(snapshot: TransactionHandle, input: {
    readonly window: FloorLineWindow;
    readonly sigunguCodeValueId: bigint;
    readonly supplierPartyIds: readonly bigint[];
  }): Promise<readonly MyFloorBidRecord[]>;
}
