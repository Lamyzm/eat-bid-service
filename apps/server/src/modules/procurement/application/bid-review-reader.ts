/**
 * @module 책임: 복기가 읽는 사실(내 사업자가 넣은 달 목록, 한 달의 개찰 회차와 명단 투찰률·실제 낙찰, 화면 장부)의 port와 record를
 * 소유한다.
 */
import type { Temporal } from "@eatbid/domain";

import type { TransactionHandle } from "../../../platform/database/unit-of-work";
import type { BidDisplayMethod } from "./bid-display-ledger";

export interface BidReviewMonthRecord {
  /** KST 달(`2026-09`)이다. */
  readonly month: string;
  readonly rounds: number;
  readonly bids: number;
  readonly wins: number;
}

export interface BidReviewOwnBidRecord {
  readonly supplierPartyId: bigint;
  readonly label: string | null;
  /** 예정가격 대비 투찰률(소수 셋째 자리)이다. 금액 열은 실격 투찰에서 자리표시자라 쓰지 않는다. */
  readonly rate: string;
}

export interface BidReviewRoundRecord {
  readonly auctionAttemptId: bigint;
  readonly openedAt: Temporal.Instant;
  readonly deadlineAt: Temporal.Instant | null;
  readonly displayBidNo: string | null;
  readonly title: string | null;
  readonly organizationLabel: string | null;
  readonly itemLabel: string | null;
  readonly baseAmount: string;
  /** 예정가격이 관측되지 않은 회차는 null이다. 하한을 모르면 대조하지 않는다. */
  readonly plannedAmount: string | null;
  readonly floorRate: string;
  readonly bidderCount: number;
  readonly competitorRates: readonly string[];
  readonly own: readonly BidReviewOwnBidRecord[];
  /** 실제 낙찰 결정의 업체와 그 업체의 명단 투찰률(예정가격 대비 %)이다. 낙찰이 없거나 명단에서 그 줄을 못 찾으면 null이다. */
  readonly award: {
    readonly supplierPartyId: bigint;
    readonly label: string | null;
    readonly rate: string;
  } | null;
}

export interface BidReviewLedgerRecord {
  readonly auctionAttemptId: bigint;
  readonly method: BidDisplayMethod;
  readonly methodVersion: string;
  readonly floorRate: string;
  /** 화면 숫자 그대로의 기초금액 대비 %다(1번, 있으면 2번). */
  readonly baseRelativeRates: readonly string[];
  readonly firstServedAt: Temporal.Instant;
}

/**
 * 한 읽기 스냅샷에서 부른다. 달 목록·회차·장부가 서로 다른 시점을 보면 같은 달의 숫자가 표와 목록에서 갈린다.
 * 회차는 활성 build의 회차 요약(최신 revision)에서 고른다 — 우리 투찰이 그 revision 명단에 있어야 그 회차가 우리 공고다.
 */
export interface BidReviewReader {
  listMonths(snapshot: TransactionHandle, input: { readonly supplierPartyIds: readonly bigint[] }): Promise<readonly BidReviewMonthRecord[]>;
  findRounds(snapshot: TransactionHandle, input: {
    readonly supplierPartyIds: readonly bigint[];
    readonly openedFrom: Temporal.Instant;
    readonly openedBefore: Temporal.Instant;
  }): Promise<readonly BidReviewRoundRecord[]>;
  findLedger(snapshot: TransactionHandle, input: {
    readonly workspaceId: bigint;
    readonly auctionAttemptIds: readonly bigint[];
  }): Promise<readonly BidReviewLedgerRecord[]>;
}
