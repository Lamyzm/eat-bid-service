/**
 * @module 책임: 요청자 워크스페이스의 등록 사업자 시장에서 지금까지 보인 사실로 단골 업체의 오늘 자리를 읽어, 공고마다 아침 습관
 * 맞춤 배수를 고르는 일을 소유한다.
 *
 * 공고 상세와 오늘 투찰이 같이 쓴다. 시장 읽기·단골·유지 확률은 (워크스페이스, 결정 시각)의 함수라 요청마다 한 번 하고, 단골
 * 배치는 마감일마다 한 번, 참여 수만 다른 공고별 계산은 그 위에서 한다. 화면의 결정 시각은 요청 시각이다 — 결과가 들어오는 대로
 * 값이 바뀌는 것이 이 방법의 뜻이라 저장하지 않는다(ADR 0067). 복기는 지난 공고마다 마감 10분 전을 결정 시각으로 같은 결정을
 * 다시 한다(`decideAt`).
 */
import { canonicalDecimal, ratio, Temporal, type BidRate, type Clock, type Money, type Ratio } from "@eatbid/domain";

import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import type { UnitOfWork } from "../../../platform/database/unit-of-work";
import { bidCountBasisOf } from "../domain/bid-position-rule";
import { positionsOf, type MarketPickPosition } from "../domain/market-position-pick";
import { MORNING_HABIT_PICK } from "../domain/morning-habit-pick-table";
import { bestTickets, ticketWinTable } from "../domain/morning-habit-win-probability";
import {
  habitDecisionOf,
  HabitHistoryIndex,
  HabitMarketIndex,
  habitWindowsAt,
  type HabitMarketAt,
  type MorningHabitDecision,
  type MorningHabitNotApplicableReason,
} from "./morning-habit-market";
import type { MorningHabitReader } from "./morning-habit-reader";

export type { MorningHabitDecision, MorningHabitNotApplicableReason } from "./morning-habit-market";

/**
 * 등록 판정과 시장·이력 조회를 한 읽기 스냅샷에서 한다. 둘이 다른 시점을 보면 방금 회수된 사업자의 시장으로 고를 수 있다.
 * 창의 양끝은 주입된 clock으로 정한다(AGENTS 17).
 */
export class DecideMorningHabitPick {
  constructor(
    private readonly snapshot: UnitOfWork,
    private readonly businesses: RegisteredBusinessReader,
    private readonly reader: MorningHabitReader,
    private readonly clock: Clock,
  ) {}

  /**
   * 실패는 던지지 않고 `market-data-unavailable`로 닫는다 — 이 맞춤의 장애로 다른 추천 금액까지 잃지 않게 한다. 공고 하나만 볼
   * 때는 그 하한율을 넘겨 맞춤 밖이면 읽지 않고 닫는다.
   */
  async decide(input: { readonly workspaceId: bigint; readonly floorRate?: BidRate | null }): Promise<MorningHabitDecision> {
    const method = MORNING_HABIT_PICK;
    const decidedAt = this.clock.now();
    if (input.floorRate === null) return closedAt(decidedAt, ["floor-rate-unobserved"], null);
    if (input.floorRate !== undefined && input.floorRate !== method.floorRate) {
      return closedAt(decidedAt, ["floor-rate-outside-habit-pick"], null);
    }
    const [decision] = await this.decideAt({ workspaceId: input.workspaceId, decisionTimes: [decidedAt] });
    return decision!;
  }

  /**
   * 지난 공고를 그 시각의 눈으로 다시 고른다(복기: 공고마다 마감 10분 전). 시각마다 따로 읽지 않고 가장 이른 시각의 창부터 가장
   * 늦은 시각까지 한 번 읽은 뒤, 시각마다 그 시각의 창으로 잘라 같은 계산을 한다 — 시각 하나씩 읽은 것과 같은 회차·이력을 본다.
   * 결과는 받은 시각 순서대로다. 실패는 모든 시각을 `market-data-unavailable`로 닫는다.
   */
  async decideAt(input: {
    readonly workspaceId: bigint;
    readonly decisionTimes: readonly Temporal.Instant[];
  }): Promise<readonly MorningHabitDecision[]> {
    const method = MORNING_HABIT_PICK;
    const times = input.decisionTimes;
    if (times.length === 0) return [];
    const earliest = times.reduce((left, right) => (Temporal.Instant.compare(left, right) <= 0 ? left : right));
    const latest = times.reduce((left, right) => (Temporal.Instant.compare(left, right) >= 0 ? left : right));
    const floorRate = method.floorRate as BidRate;
    try {
      const read = await this.snapshot.run(async (snapshot) => {
        const businesses = await this.businesses.list(snapshot, input.workspaceId);
        const own = businesses.flatMap((business) =>
          business.supplier.kind === "linked" ? [business.supplier.supplierPartyId] : []);
        if (own.length === 0) return null;
        const records = await this.reader.findMarketRounds(snapshot, {
          supplierPartyIds: own, floorRate, openedFrom: habitWindowsAt(method, earliest).marketFrom, openedBefore: latest,
        });
        const ownSet = new Set(own.map((party) => party.toString()));
        const market = new HabitMarketIndex(method, records);
        const regulars = times.map((decidedAt) => market.marketAt(decidedAt, ownSet));
        // 시각마다 단골이 다르다. 한 번만 읽도록 모두의 합집합을 읽고, 시각마다 자기 단골만 남긴다.
        const firms = [...new Set(regulars.flatMap((market) => (market.regulars.kind === "decided" ? market.regulars.firms : [])))];
        const bids = firms.length === 0 ? [] : await this.reader.findFirmBids(snapshot, {
          supplierPartyIds: firms.map((firm) => BigInt(firm)),
          floorRate,
          openedFrom: habitWindowsAt(method, earliest).historyFrom,
          openedBefore: latest,
        });
        return { own, ownSet, regulars, histories: new HabitHistoryIndex(method, bids) };
      });
      if (read === null) return times.map((decidedAt) => closedAt(decidedAt, ["no-linked-business"], null));
      const decisions: MorningHabitDecision[] = [];
      for (const market of read.regulars) {
        decisions.push(decisionFor(market, read));
        // 시각 하나가 수백 ms 걸린다. 여러 시각을 고르는 동안(복기) 같은 서버의 다른 요청이 기다리지 않게 틈을 준다.
        if (times.length > 1) await new Promise((resolve) => setImmediate(resolve));
      }
      return decisions;
    } catch {
      return times.map((decidedAt) => closedAt(decidedAt, ["market-data-unavailable"], null));
    }
  }
}

function closedAt(
  decidedAt: Temporal.Instant,
  reasons: readonly MorningHabitNotApplicableReason[],
  marketRounds: number | null,
): MorningHabitDecision {
  return { kind: "not-applicable", method: MORNING_HABIT_PICK, decidedAt, reasons, marketRounds };
}

function decisionFor(
  market: HabitMarketAt,
  read: { readonly own: readonly bigint[]; readonly ownSet: ReadonlySet<string>; readonly histories: HabitHistoryIndex },
): MorningHabitDecision {
  const { regulars } = market;
  if (regulars.kind === "too-few-rounds") return closedAt(market.decidedAt, ["market-rounds-below-minimum"], regulars.marketRounds);
  return habitDecisionOf({
    method: MORNING_HABIT_PICK,
    at: { ...market, regulars },
    histories: read.histories,
    own: read.ownSet,
    linkedBusinesses: read.own.length,
  });
}

export type MorningHabitPickResult =
  | {
    readonly state: "applicable";
    readonly decidedAt: Temporal.Instant;
    /** 단골 참여율로 가중한, 오늘 자리가 보인 단골의 몫이다(소수 여섯째 자리, 공개 ratio 계약과 같다). */
    readonly coverage: Ratio;
    readonly regulars: number;
    readonly sameDayRegulars: number;
    readonly latestSameDayOpenedAt: Temporal.Instant | null;
    /** 경쟁 배치를 그린 참여 수다(우리 업체 포함 여부는 관측값을 따른다). */
    readonly competitorCount: number;
    /** 등록 사업자가 둘 이상이면 두 장(낮은 배수가 1번), 하나면 한 장이다. */
    readonly positions: readonly MarketPickPosition[];
    /** 한 곳만 넣는 공고에 쓸 금액이다. 두 장의 1번과 다르다. */
    readonly single: MarketPickPosition;
  }
  | {
    readonly state: "not-applicable";
    readonly reasons: readonly MorningHabitNotApplicableReason[];
    /** 덮임을 쟀으면 그 값이다. 문턱 아래라 닫힌 공고에서 "오늘 정보가 얼마나 보였는지"를 보인다. */
    readonly coverage: Ratio | null;
  };

/**
 * 경쟁 배치를 그릴 참여 수다. 전국 공식과 같은 마감 1시간 전 참여 수(관측 또는 보정 추정)를 쓴다 — 분석은 마감 직전까지 들어온
 * 참여 수로 그렸다. 참여를 관측하지 못했으면 `null`이다.
 */
export function habitCompetitorCount(auction: {
  readonly floorRate: BidRate | null;
  readonly deadlineAt: Temporal.Instant | null;
  readonly participation: { readonly bidCount: number; readonly observedAt: Temporal.Instant } | null;
}): number | null {
  if (auction.floorRate === null || auction.participation === null) return null;
  const basis = bidCountBasisOf({
    floorRate: auction.floorRate,
    bidCount: auction.participation.bidCount,
    observedAt: auction.participation.observedAt,
    deadlineAt: auction.deadlineAt,
  });
  return basis.kind === "observed" ? basis.bidCount : basis.estimatedBidCount;
}

const coverageRatio = (value: number) => ratio(canonicalDecimal(value.toFixed(6), 6));

/**
 * 결정을 공고 하나의 금액으로 바꾼다. 참여 수는 전국 공식과 같은 마감 1시간 전 참여 수(관측 또는 보정 추정)다 — 분석은 마감
 * 직전 참여 수로 배치를 그렸다.
 */
export function morningHabitPickFor(
  decision: MorningHabitDecision,
  auction: {
    readonly baseAmount: Money;
    readonly floorRate: BidRate | null;
    readonly deadlineAt: Temporal.Instant | null;
    readonly competitorCount: number | null;
  },
): MorningHabitPickResult {
  const closed = (reasons: readonly MorningHabitNotApplicableReason[], coverage: Ratio | null = null): MorningHabitPickResult =>
    ({ state: "not-applicable", reasons, coverage });
  if (auction.floorRate === null) return closed(["floor-rate-unobserved"]);
  if (auction.floorRate !== decision.method.floorRate) return closed(["floor-rate-outside-habit-pick"]);
  if (decision.kind === "not-applicable") return closed(decision.reasons);
  if (auction.deadlineAt === null) return closed(["deadline-unobserved"]);
  if (Temporal.Instant.compare(auction.deadlineAt, decision.decidedAt) <= 0) return closed(["deadline-passed"]);
  if (auction.competitorCount === null) return closed(["participation-unobserved"]);
  const day = decision.market.dayOf(auction.deadlineAt);
  if (day.coverage < decision.method.coverageThreshold) {
    return closed(["same-day-coverage-below-threshold"], coverageRatio(day.coverage));
  }
  const table = ticketWinTable(decision.market.basisOf(day), auction.competitorCount);
  const single = bestTickets(table, 1);
  // 검증한 장수는 두 장이다. 사업자가 셋 이상이어도 두 장까지만 낸다.
  const pick = decision.linkedBusinesses >= 2 ? bestTickets(table, 2) : single;
  return {
    state: "applicable",
    decidedAt: decision.decidedAt,
    coverage: coverageRatio(day.coverage),
    regulars: decision.regulars,
    sameDayRegulars: day.sameDayRegulars,
    latestSameDayOpenedAt: day.latestSameDayOpenedAt,
    competitorCount: auction.competitorCount,
    positions: positionsOf(auction.baseAmount, auction.floorRate, pick.multiples),
    single: positionsOf(auction.baseAmount, auction.floorRate, single.multiples)[0]!,
  };
}
