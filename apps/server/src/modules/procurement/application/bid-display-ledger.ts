/**
 * @module 책임: 오늘 투찰·공고 상세가 내보낸 방법별 금액을 화면 장부 항목으로 바꾸는 규칙과 그 장부 port를 소유한다.
 *
 * 복기는 그때 화면에 보인 값과 개찰 사실을 대조한다(PDR-0008 결정 7, ADR 0068). 그래서 장부 항목은 화면이 실제로 그리는 것과 같아야
 * 한다 — 오늘 투찰은 하한율 88% 공고에 금액을 보이지 않으므로 그 행을 남기지 않고, 공고 상세는 88%에도 전국 공식 금액을 보이므로 남긴다.
 */
import type { BaseRelativeBidRate, BidRate, Temporal } from "@eatbid/domain";

import { BID_POSITION_RULE, type BidPositionResult } from "../domain/bid-position-rule";
import type { MarketPickResult } from "../domain/market-position-pick";
import type { AuctionBidPositionRecord } from "./find-auction-bid-position";
import type { MarketPickDecision } from "./decide-market-pick";
import type { MorningHabitDecision, MorningHabitPickResult } from "./decide-morning-habit-pick";
import type { MyBidBoardRecord } from "./get-my-bid-board";

export type BidDisplayMethod = "market-pick" | "national-rule" | "morning-habit";

export interface BidDisplayEntry {
  readonly auctionAttemptId: bigint;
  readonly method: BidDisplayMethod;
  readonly methodVersion: string;
  readonly floorRate: BidRate;
  /** 1번, 있으면 2번이다. 화면의 기초금액 대비 % 그대로다 — 사정률은 이 값을 하한율로 나눈 것이다(ADR 0066). */
  readonly baseRelativeRates: readonly [BaseRelativeBidRate] | readonly [BaseRelativeBidRate, BaseRelativeBidRate];
  readonly singleBaseRelativeRate: BaseRelativeBidRate | null;
  readonly basisPeriod: string | null;
  readonly basisObservedThrough: Temporal.Instant | null;
  readonly basisCount: number | null;
}

/**
 * 장부 쓰기는 화면을 막지 않는다. 구현은 실패를 던지지 않고 분류형 로그로만 남긴다 — 장부가 비면 그날 복기가 비지만, 장부 때문에
 * 투찰 화면이 503이 되면 사용자가 금액을 못 본다. 같은 공고·방법·판·금액은 한 줄이고 다시 내보내면 마지막 시각만 바뀐다.
 */
export interface BidDisplayLedger {
  record(input: {
    readonly workspaceId: bigint;
    readonly servedAt: Temporal.Instant;
    readonly entries: readonly BidDisplayEntry[];
  }): Promise<void>;
}

const BOARD_SHOWN_FLOOR_RATE = "90.000";

type Rates = BidDisplayEntry["baseRelativeRates"];

function ratesOf(positions: readonly { readonly baseRelativeRate: BaseRelativeBidRate }[]): Rates | null {
  const [first, second] = positions;
  if (first === undefined) return null;
  return second === undefined ? [first.baseRelativeRate] : [first.baseRelativeRate, second.baseRelativeRate];
}

function ruleEntry(auctionAttemptId: bigint, floorRate: BidRate, result: BidPositionResult | null): BidDisplayEntry | null {
  if (result === null || result.state !== "applicable") return null;
  // 화면은 1번·2번만 칸에 둔다. 3번 뒤는 더 보기 안의 참고라 장부의 대조 대상이 아니다.
  const rates = ratesOf(result.positions.slice(0, 2));
  if (rates === null) return null;
  const basis = result.bidCountBasis;
  return {
    auctionAttemptId,
    method: "national-rule",
    methodVersion: BID_POSITION_RULE.version,
    floorRate,
    baseRelativeRates: rates,
    singleBaseRelativeRate: null,
    basisPeriod: null,
    basisObservedThrough: null,
    basisCount: basis.kind === "observed" ? basis.bidCount : basis.estimatedBidCount,
  };
}

interface MarketBasis {
  readonly version: string;
  readonly window: { readonly fromMonth: string; readonly throughMonth: string };
}

function marketEntry(
  auctionAttemptId: bigint,
  floorRate: BidRate,
  basis: MarketBasis,
  result: MarketPickResult | null,
): BidDisplayEntry | null {
  if (result === null || result.state !== "applicable") return null;
  const rates = ratesOf(result.positions);
  if (rates === null) return null;
  return {
    auctionAttemptId,
    method: "market-pick",
    methodVersion: basis.version,
    floorRate,
    baseRelativeRates: rates,
    singleBaseRelativeRate: result.single.baseRelativeRate,
    basisPeriod: `${basis.window.fromMonth}~${basis.window.throughMonth}`,
    basisObservedThrough: null,
    basisCount: result.marketRounds,
  };
}

function habitEntry(
  auctionAttemptId: bigint,
  floorRate: BidRate,
  version: string,
  result: MorningHabitPickResult | null,
): BidDisplayEntry | null {
  if (result === null || result.state !== "applicable") return null;
  const rates = ratesOf(result.positions);
  if (rates === null) return null;
  return {
    auctionAttemptId,
    method: "morning-habit",
    methodVersion: version,
    floorRate,
    baseRelativeRates: rates,
    singleBaseRelativeRate: result.single.baseRelativeRate,
    basisPeriod: null,
    basisObservedThrough: result.latestSameDayOpenedAt,
    basisCount: result.sameDayRegulars,
  };
}

const present = (entry: BidDisplayEntry | null): entry is BidDisplayEntry => entry !== null;

/** 오늘 투찰 한 번이 내보낸 금액이다. 88% 행은 화면이 금액 없이 "직접 판단"만 달아 남기지 않는다(PDR-0008 결정 3). */
export function boardDisplayEntries(record: MyBidBoardRecord): readonly BidDisplayEntry[] {
  if (record.state !== "confirmed") return [];
  const habitVersion = habitVersionOf(record.habit);
  return record.rows.flatMap((row) => {
    const floorRate = row.auction.floorRate;
    if (floorRate === null || floorRate !== BOARD_SHOWN_FLOOR_RATE) return [];
    const id = row.auction.auctionAttemptId;
    return [
      habitVersion === null ? null : habitEntry(id, floorRate, habitVersion, row.morningHabit),
      marketEntry(id, floorRate, marketBasisOf(record.decision), row.market?.result ?? null),
      ruleEntry(id, floorRate, row.rule),
    ].filter(present);
  });
}

/** 공고 상세 한 번이 내보낸 금액이다. */
export function positionDisplayEntries(record: AuctionBidPositionRecord): readonly BidDisplayEntry[] {
  const { floorRate } = record;
  if (floorRate === null) return [];
  const id: bigint = record.auctionId;
  return [
    record.morningHabit === null ? null : habitEntry(id, floorRate, record.morningHabit.method.version, record.morningHabit.result),
    marketEntry(id, floorRate, { version: record.marketPick.method.version, window: record.marketPick.window }, record.marketPick.result),
    ruleEntry(id, floorRate, record.result),
  ].filter(present);
}

function habitVersionOf(habit: MorningHabitDecision | null): string | null {
  return habit === null ? null : habit.method.version;
}

function marketBasisOf(decision: MarketPickDecision): MarketBasis {
  return { version: decision.method.version, window: decision.window };
}

/**
 * 장부 실패를 삼키고 알리는 감싸개다. use case는 장부가 던지지 않는다고 믿고 기다리기만 한다 — 장부 때문에 투찰 화면이 실패하면 안 된다.
 */
export class QuietBidDisplayLedger implements BidDisplayLedger {
  constructor(
    private readonly inner: BidDisplayLedger,
    private readonly onFailure: (error: unknown) => void,
  ) {}

  async record(input: Parameters<BidDisplayLedger["record"]>[0]): Promise<void> {
    if (input.entries.length === 0) return;
    try {
      await this.inner.record(input);
    } catch (error) {
      this.onFailure(error);
    }
  }
}

/** 장부가 없는 조립(시험·도구)에서 쓴다. */
export const NO_BID_DISPLAY_LEDGER: BidDisplayLedger = { record: async () => undefined };
