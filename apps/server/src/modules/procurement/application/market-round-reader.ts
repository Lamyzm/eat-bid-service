/**
 * @module 책임: 최근 3개월 맞춤이 읽는 "등록 사업자가 넣은 최근 공고의 경쟁 투찰 배치" port를 정의한다.
 *
 * 공고 조회 port와 나눈 이유는 읽는 단위가 다르기 때문이다. 공고 조회는 한 회차의 관측이고, 이 port는 요청자의 사업자가 낸
 * 여러 회차를 한 번에 읽는다. 등록 판정과 같은 스냅샷에서 읽어야 방금 회수된 등록의 시장을 섞지 않는다.
 */
import type { BidRate, Temporal } from "@eatbid/domain";
import type { TransactionHandle } from "../../../platform/database/unit-of-work";
import type { MarketRound } from "../domain/market-position-pick";

export interface MarketRoundQuery {
  readonly supplierPartyIds: readonly bigint[];
  readonly floorRate: BidRate;
  /** 개찰 시각 창 `[openedFrom, openedBefore)`이다. 창의 양끝은 use case가 주입된 clock으로 정한다(AGENTS 17). */
  readonly openedFrom: Temporal.Instant;
  readonly openedBefore: Temporal.Instant;
}

export interface MarketRoundReader {
  /**
   * 창 안에 개찰된 그 하한율 회차 가운데 `supplierPartyIds` 업체가 하나라도 낸 회차를, 그 업체들의 투찰을 뺀 경쟁 투찰 배치로
   * 돌려준다. 회차마다 마지막 revision의 투찰만 쓴다 — 분석 스크립트(`sql/10`)와 같은 정의라야 검증 수치가 이 계산의 근거가 된다.
   */
  findRounds(snapshot: TransactionHandle, query: MarketRoundQuery): Promise<readonly MarketRound[]>;
}
