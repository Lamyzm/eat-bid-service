/**
 * @module 책임: 아침 습관 맞춤이 읽는 두 사실 묶음(등록 사업자 시장의 공고별 전체 투찰, 단골 업체의 전국 투찰 이력) port를 정의한다.
 *
 * 매달 맞춤 port(`market-round-reader.ts`)와 나눈 이유는 읽는 모양이 다르기 때문이다. 매달 맞춤은 우리 투찰을 뺀 경쟁 배수만
 * 세지만, 습관 맞춤은 누가 넣었는지(단골인지, 오늘 어디에 넣었는지)를 봐야 한다. 등록 판정과 같은 읽기 스냅샷에서 읽어야
 * 방금 회수된 등록의 시장을 섞지 않는다.
 */
import type { BidRate, Temporal } from "@eatbid/domain";
import type { TransactionHandle } from "../../../platform/database/unit-of-work";
import type { FloorRelativeRatio } from "../domain/market-position-pick";

/** 개찰 시각 창 `[openedFrom, openedBefore)`이다. 창의 양끝은 use case가 주입된 clock으로 정한다(AGENTS 17). */
export interface HabitWindow {
  readonly floorRate: BidRate;
  readonly openedFrom: Temporal.Instant;
  readonly openedBefore: Temporal.Instant;
}

export interface HabitMarketRoundRecord {
  readonly openedAt: Temporal.Instant;
  readonly deadlineAt: Temporal.Instant;
  /** 우리 업체 투찰을 포함한 마지막 revision의 투찰 전부다(투찰 시각 순). */
  readonly bids: readonly { readonly supplierPartyId: bigint; readonly ratio: FloorRelativeRatio }[];
}

export interface HabitFirmBidRecord {
  readonly supplierPartyId: bigint;
  readonly openedAt: Temporal.Instant;
  readonly deadlineAt: Temporal.Instant;
  readonly ratio: FloorRelativeRatio;
}

export interface MorningHabitReader {
  /**
   * 창 안에 개찰된 그 하한율 회차 가운데 `supplierPartyIds` 업체가 마지막 revision에 투찰한 회차를 개찰 순으로 낸다. 매달 맞춤과
   * 같은 시장 정의다 — 예정가격이 기초금액 ±3.1% 밖인 회차는 뺀다.
   */
  findMarketRounds(
    snapshot: TransactionHandle,
    query: HabitWindow & { readonly supplierPartyIds: readonly bigint[] },
  ): Promise<readonly HabitMarketRoundRecord[]>;

  /**
   * `supplierPartyIds` 업체가 창 안에 전국에서 넣은 그 하한율 투찰을 업체·개찰·투찰 순으로 낸다. 회차마다 마지막 revision의 투찰만
   * 쓴다. "오늘 어디에 넣었는가"는 김해 밖 공고에서도 보이므로 지역으로 좁히지 않는다.
   */
  findFirmBids(
    snapshot: TransactionHandle,
    query: HabitWindow & { readonly supplierPartyIds: readonly bigint[] },
  ): Promise<readonly HabitFirmBidRecord[]>;
}
