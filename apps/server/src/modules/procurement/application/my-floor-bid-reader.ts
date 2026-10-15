/**
 * @module 책임: 하한선 자리의 내 사업자 조회 port 둘(겹칠 투찰의 값·결과·등수, 투찰이 가장 많은 공고지역)과 그 레코드를 정의한다.
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

/** 내 등록 사업자가 투찰한 회차가 가장 많은 공고지역 시군구와 그 시도다. 이름은 관측 라벨이라 없을 수 있다. */
export interface MyFloorRegionRecord {
  readonly sidoCodeValueId: bigint;
  readonly sidoLabel: string | null;
  readonly sigunguCodeValueId: bigint;
  readonly sigunguLabel: string | null;
  readonly roundCount: number;
}

/**
 * 투찰 port와 나눠 둔다. 지역을 찾는 조회는 지역을 받지 않고, 투찰 조회는 지역을 받아야 해서 쓰는 쪽이 서로의 메서드를 알 까닭이
 * 없다. 구현은 같은 회차 술어를 쓰므로 한 adapter가 둘 다 맡는다.
 */
export interface MyFloorRegionReader {
  readTopRegion(snapshot: TransactionHandle, input: {
    readonly window: FloorLineWindow;
    readonly supplierPartyIds: readonly bigint[];
  }): Promise<MyFloorRegionRecord | null>;
}
