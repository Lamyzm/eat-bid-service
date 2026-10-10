/**
 * @module 책임: 요청자 워크스페이스의 등록 사업자 시장에서 이번 달 맞춤 배수(두 장·한 장·예비)를 한 번 고르고, 그 결정을 공고 하나의
 * 금액으로 바꾸는 일을 소유한다.
 *
 * 공고 상세와 오늘 투찰이 같이 쓴다. 배수는 공고가 아니라 (워크스페이스, 하한율 90 시장, 현재 KST 달)의 함수라, 목록이 공고마다
 * 시장을 다시 읽으면 같은 답을 수백 번 계산하고 행마다 다른 시점을 볼 수 있다.
 */
import { Temporal, type BidRate, type Clock, type Money } from "@eatbid/domain";

import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import type { UnitOfWork } from "../../../platform/database/unit-of-work";
import { KST_TIME_ZONE, kstMonthFirstDayText, kstMonthOf, shiftKstMonth, type KstMonth } from "../domain/kst-month";
import {
  marketPositionBids,
  pickMarketMultiples,
  spareMarketMultiples,
  type MarketPick,
  type MarketPickNotApplicableReason,
  type MarketPickResult,
} from "../domain/market-position-pick";
import { MARKET_POSITION_PICK, type MarketPositionPickMethod } from "../domain/market-position-pick-table";
import { PLANNED_RATIO_DISTRIBUTION } from "../domain/planned-ratio-distribution-table";
import type { MarketRoundReader } from "./market-round-reader";

/** 예비 순위 수와 서로 떨어뜨릴 간격(0.0001 단위)이다. 화면이 1~5순위를 보이므로 두 장 뒤 셋이다(PDR-0008). */
const SPARE_COUNT = 3;
const SPARE_MINIMUM_GAP = 5;

/** 고르는 데 쓴 개찰 달 `[fromMonth, throughMonth]`와 금액을 쓰는 달이다. 요청한 달은 아직 끝나지 않아 창에 넣지 않는다. */
export interface MarketPickWindow {
  readonly fromMonth: KstMonth;
  readonly throughMonth: KstMonth;
  readonly currentMonth: KstMonth;
}

export type MarketPickDecision =
  | {
    readonly kind: "picked";
    readonly method: MarketPositionPickMethod;
    readonly window: MarketPickWindow;
    /** 사업자가 둘 이상이면 두 장, 하나면 한 장 배수다. */
    readonly pick: MarketPick;
    /** 한 곳만 넣는 공고의 배수다. 두 장의 1번은 2번이 덮는 구간을 전제로 고른 자리라 혼자일 때 최선이 아니다. */
    readonly single: MarketPick;
    readonly spares: readonly string[];
    readonly marketRounds: number;
    readonly linkedBusinesses: number;
  }
  | {
    readonly kind: "not-applicable";
    readonly method: MarketPositionPickMethod;
    readonly window: MarketPickWindow;
    readonly reasons: readonly MarketPickNotApplicableReason[];
    readonly marketRounds: number | null;
  };

function monthStart(month: KstMonth): Temporal.Instant {
  return Temporal.PlainDate.from(kstMonthFirstDayText(month)).toZonedDateTime(KST_TIME_ZONE).toInstant();
}

/**
 * 등록 판정과 시장 조회를 한 읽기 스냅샷에서 한다. 둘이 다른 시점을 보면 방금 회수된 사업자의 시장으로 금액을 고를 수 있다.
 * 창의 양끝은 주입된 clock으로 정한다(AGENTS 17).
 */
export class DecideMarketPick {
  constructor(
    private readonly snapshot: UnitOfWork,
    private readonly businesses: RegisteredBusinessReader,
    private readonly marketRounds: MarketRoundReader,
    private readonly clock: Clock,
  ) {}

  /**
   * 실패는 던지지 않고 `market-data-unavailable` 결정으로 닫는다 — 맞춤 장애로 전국 규칙 금액까지 잃지 않게 한다.
   *
   * 공고 하나만 볼 때는 그 공고의 하한율을 함께 넘긴다. 맞춤 밖 하한율이면 시장을 읽을 이유가 없어 읽지 않고 닫는다.
   * 목록은 하한율이 섞여 있으므로 넘기지 않고 한 번 읽는다.
   */
  async decide(input: { readonly workspaceId: bigint; readonly floorRate?: BidRate | null }): Promise<MarketPickDecision> {
    const method = MARKET_POSITION_PICK;
    const currentMonth = kstMonthOf(this.clock.now());
    const window: MarketPickWindow = {
      fromMonth: shiftKstMonth(currentMonth, -method.windowMonths),
      throughMonth: shiftKstMonth(currentMonth, -1),
      currentMonth,
    };
    const closed = (reasons: readonly MarketPickNotApplicableReason[], marketRounds: number | null): MarketPickDecision =>
      ({ kind: "not-applicable", method, window, reasons, marketRounds });
    if (input.floorRate === null) return closed(["floor-rate-unobserved"], null);
    if (input.floorRate !== undefined && input.floorRate !== method.floorRate) {
      return closed(["floor-rate-outside-market-pick"], null);
    }
    try {
      const market = await this.snapshot.run(async (snapshot) => {
        const businesses = await this.businesses.list(snapshot, input.workspaceId);
        // 원본에서 아직 관측되지 않았거나 한 번호가 여러 업체를 가리키는 등록은 시장을 정할 수 없어 뺀다.
        const supplierPartyIds = businesses.flatMap((business) =>
          business.supplier.kind === "linked" ? [business.supplier.supplierPartyId] : []);
        if (supplierPartyIds.length === 0) return null;
        const rounds = await this.marketRounds.findRounds(snapshot, {
          supplierPartyIds,
          // 걸어가기 채점은 하한율 90 회차에서만 했다. 다른 하한율은 경쟁 배치의 축이 달라 근거가 없다.
          floorRate: method.floorRate as BidRate,
          openedFrom: monthStart(window.fromMonth),
          openedBefore: monthStart(currentMonth),
        });
        return { linkedBusinesses: supplierPartyIds.length, rounds };
      });
      if (market === null) return closed(["no-linked-business"], null);
      if (market.rounds.length < method.minimumRounds) return closed(["market-rounds-below-minimum"], market.rounds.length);
      // 검증한 장수는 한 장과 두 장뿐이다. 사업자가 셋 이상이어도 두 장까지만 낸다.
      const pickOf = (tickets: 1 | 2) => pickMarketMultiples({
        rounds: market.rounds, tickets, candidates: method.candidates, distribution: PLANNED_RATIO_DISTRIBUTION,
      });
      const single = pickOf(1);
      const pick = market.linkedBusinesses >= 2 ? pickOf(2) : single;
      const spares = spareMarketMultiples({
        rounds: market.rounds,
        candidates: method.candidates,
        distribution: PLANNED_RATIO_DISTRIBUTION,
        taken: [...pick.multiples, ...single.multiples],
        count: SPARE_COUNT,
        minimumGapTenThousandths: SPARE_MINIMUM_GAP,
      });
      return {
        kind: "picked", method, window, pick, single, spares,
        marketRounds: market.rounds.length, linkedBusinesses: market.linkedBusinesses,
      };
    } catch {
      return closed(["market-data-unavailable"], null);
    }
  }
}

/** 결정을 공고 하나의 금액으로 바꾼다. 하한율이 관측되지 않았거나 맞춤 하한율 밖이면 그 이유로 닫는다. */
export function marketPickFor(
  decision: MarketPickDecision,
  auction: { readonly baseAmount: Money; readonly floorRate: BidRate | null },
): MarketPickResult {
  if (auction.floorRate === null) return { state: "not-applicable", reasons: ["floor-rate-unobserved"], marketRounds: null };
  if (auction.floorRate !== decision.method.floorRate) {
    return { state: "not-applicable", reasons: ["floor-rate-outside-market-pick"], marketRounds: null };
  }
  if (decision.kind === "not-applicable") {
    return { state: "not-applicable", reasons: decision.reasons, marketRounds: decision.marketRounds };
  }
  return marketPositionBids({
    baseAmount: auction.baseAmount,
    floorRate: auction.floorRate,
    pick: decision.pick,
    single: decision.single,
    marketRounds: decision.marketRounds,
    linkedBusinesses: decision.linkedBusinesses,
  });
}
