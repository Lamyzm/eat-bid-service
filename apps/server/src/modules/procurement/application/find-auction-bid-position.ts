/**
 * @module 책임: 공고 한 건의 관측값으로 전국 추천 투찰가 규칙을 적용하고, 요청자 워크스페이스의 등록 사업자 시장에서 최근 3개월
 * 맞춤 금액을 고르는 use case와 그 내부 record를 소유한다.
 */
import { Effect } from "effect";
import { Temporal, type BidRate, type Clock, type Money } from "@eatbid/domain";

import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import type { UnitOfWork } from "../../../platform/database/unit-of-work";
import { BID_POSITION_RULE, positionBids, type BidPositionResult, type BidPositionRuleTable } from "../domain/bid-position-rule";
import type { AuctionId } from "../domain/auction-id";
import { KST_TIME_ZONE, kstMonthFirstDayText, kstMonthOf, shiftKstMonth, type KstMonth } from "../domain/kst-month";
import {
  marketPositionBids,
  pickMarketMultiples,
  type MarketPickNotApplicableReason,
  type MarketPickResult,
} from "../domain/market-position-pick";
import { MARKET_POSITION_PICK, type MarketPositionPickMethod } from "../domain/market-position-pick-table";
import { PLANNED_RATIO_DISTRIBUTION } from "../domain/planned-ratio-distribution-table";
import type { AuctionReader, ParticipationObservationRecord } from "./auction-reader";
import { AuctionDependencyUnavailable, AuctionNotFound } from "./find-auction";
import type { MarketRoundReader } from "./market-round-reader";

export interface MarketPickRecord {
  readonly method: MarketPositionPickMethod;
  /** 고르는 데 쓴 개찰 달 `[fromMonth, throughMonth]`다. 요청한 달은 아직 끝나지 않아 넣지 않는다. */
  readonly window: { readonly fromMonth: KstMonth; readonly throughMonth: KstMonth };
  readonly result: MarketPickResult;
}

export interface AuctionBidPositionRecord {
  readonly auctionId: AuctionId;
  readonly revisionId: bigint;
  readonly baseAmount: Money;
  readonly floorRate: BidRate | null;
  readonly participation: ParticipationObservationRecord | null;
  readonly deadlineAt: Temporal.Instant | null;
  readonly rule: BidPositionRuleTable;
  readonly result: BidPositionResult;
  readonly marketPick: MarketPickRecord;
}

function monthStart(month: KstMonth): Temporal.Instant {
  return Temporal.PlainDate.from(kstMonthFirstDayText(month)).toZonedDateTime(KST_TIME_ZONE).toInstant();
}

function notApplicable(reasons: readonly MarketPickNotApplicableReason[], marketRounds: number | null): MarketPickResult {
  return { state: "not-applicable", reasons, marketRounds };
}

/**
 * 공고 조회 port를 그대로 쓴다. 규칙이 쓰는 값(기초금액·하한율·목록 참여 수)이 공고 응답이 이미 싣는 관측이라
 * 새 질의를 만들면 같은 사실을 두 경로로 읽게 된다. 참여 수는 최신 관측이다 — 규칙의 조건은 마감 1시간 전
 * 참여 수이므로, 관측이 그보다 이르면 도메인의 보정표가 마감 1시간 전 참여 수를 추정하고 그 사실을 결과에 남긴다.
 *
 * 최근 3개월 맞춤은 등록 판정과 시장 조회를 한 읽기 스냅샷에서 한다. 둘이 다른 시점을 보면 방금 회수된 사업자의 시장으로
 * 금액을 고를 수 있다. 창의 양끝은 주입된 clock으로 정한다(AGENTS 17).
 */
export class FindAuctionBidPosition {
  constructor(
    private readonly reader: AuctionReader,
    private readonly snapshot: UnitOfWork,
    private readonly businesses: RegisteredBusinessReader,
    private readonly marketRounds: MarketRoundReader,
    private readonly clock: Clock,
  ) {}

  execute(input: { readonly auctionId: AuctionId; readonly workspaceId: bigint }): Effect.Effect<
    AuctionBidPositionRecord,
    AuctionNotFound | AuctionDependencyUnavailable,
    never
  > {
    return Effect.tryPromise({
      try: () => this.reader.findById(input.auctionId),
      catch: (cause) => new AuctionDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((auction) => {
        if (auction === null) return Effect.fail(new AuctionNotFound(input.auctionId));
        const floorRate = auction.terms?.floorRate ?? null;
        const participation = auction.participation?.latest ?? null;
        // 내 시장 계산이 실패해도 전국 규칙은 그대로 낸다. 맞춤 금액이 없다는 사실과 이유만 결과에 남긴다 — 한쪽 장애로
        // 패널 전체가 503이 되면 운영자는 쓸 수 있는 전국 규칙 금액까지 잃는다.
        return Effect.promise(() => this.marketPick({ workspaceId: input.workspaceId, baseAmount: auction.baseAmount, floorRate })
          .catch(() => this.unavailable())).pipe(Effect.map((marketPick): AuctionBidPositionRecord => ({
          auctionId: auction.auctionId,
          revisionId: auction.revisionId,
          baseAmount: auction.baseAmount,
          floorRate,
          participation,
          deadlineAt: auction.deadlineAt,
          rule: BID_POSITION_RULE,
          result: positionBids({ baseAmount: auction.baseAmount, floorRate, participation, deadlineAt: auction.deadlineAt }),
          marketPick,
        })));
      }),
    );
  }

  private unavailable(): MarketPickRecord {
    const current = kstMonthOf(this.clock.now());
    return {
      method: MARKET_POSITION_PICK,
      window: { fromMonth: shiftKstMonth(current, -MARKET_POSITION_PICK.windowMonths), throughMonth: shiftKstMonth(current, -1) },
      result: notApplicable(["market-data-unavailable"], null),
    };
  }

  private async marketPick(input: {
    readonly workspaceId: bigint;
    readonly baseAmount: Money;
    readonly floorRate: BidRate | null;
  }): Promise<MarketPickRecord> {
    const method = MARKET_POSITION_PICK;
    const current = kstMonthOf(this.clock.now());
    const window = { fromMonth: shiftKstMonth(current, -method.windowMonths), throughMonth: shiftKstMonth(current, -1) };
    const record = (result: MarketPickResult): MarketPickRecord => ({ method, window, result });
    // 걸어가기 채점은 하한율 90 회차에서만 했다. 다른 하한율은 경쟁 배치의 축이 달라 근거가 없다.
    if (input.floorRate === null) return record(notApplicable(["floor-rate-unobserved"], null));
    if (input.floorRate !== method.floorRate) return record(notApplicable(["floor-rate-outside-market-pick"], null));
    const floorRate = input.floorRate;
    const market = await this.snapshot.run(async (snapshot) => {
      const businesses = await this.businesses.list(snapshot, input.workspaceId);
      // 원본에서 아직 관측되지 않았거나 한 번호가 여러 업체를 가리키는 등록은 시장을 정할 수 없어 뺀다.
      const supplierPartyIds = businesses.flatMap((business) =>
        business.supplier.kind === "linked" ? [business.supplier.supplierPartyId] : []);
      if (supplierPartyIds.length === 0) return null;
      const rounds = await this.marketRounds.findRounds(snapshot, {
        supplierPartyIds,
        floorRate,
        openedFrom: monthStart(window.fromMonth),
        openedBefore: monthStart(current),
      });
      return { linkedBusinesses: supplierPartyIds.length, rounds };
    });
    if (market === null) return record(notApplicable(["no-linked-business"], null));
    if (market.rounds.length < method.minimumRounds) {
      return record(notApplicable(["market-rounds-below-minimum"], market.rounds.length));
    }
    // 검증한 장수는 한 장과 두 장뿐이다. 사업자가 셋 이상이어도 맞춤은 두 장까지만 낸다. 한 곳만 넣는 공고를 위해
    // 한 장 최선 자리는 늘 따로 고른다 — 두 장의 1번은 2번이 덮는 구간을 전제로 고른 자리라 혼자일 때 최선이 아니다.
    const pickOf = (tickets: 1 | 2) => pickMarketMultiples({
      rounds: market.rounds,
      tickets,
      candidates: method.candidates,
      distribution: PLANNED_RATIO_DISTRIBUTION,
    });
    const single = pickOf(1);
    return record(marketPositionBids({
      baseAmount: input.baseAmount,
      floorRate,
      pick: market.linkedBusinesses >= 2 ? pickOf(2) : single,
      single,
      marketRounds: market.rounds.length,
      linkedBusinesses: market.linkedBusinesses,
    }));
  }
}
