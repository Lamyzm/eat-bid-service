/**
 * @module 책임: 요청자 워크스페이스의 등록 사업자 시장에서 지금까지 보인 사실로 단골 업체의 오늘 자리를 읽어, 공고마다 아침 습관
 * 맞춤 배수를 고르는 일을 소유한다.
 *
 * 공고 상세와 오늘 투찰이 같이 쓴다. 시장 읽기·단골·유지 확률은 (워크스페이스, 결정 시각)의 함수라 요청마다 한 번 하고, 단골
 * 배치는 마감일마다 한 번, 참여 수만 다른 공고별 계산은 그 위에서 한다. 결정 시각은 요청 시각이다 — 결과가 들어오는 대로 값이
 * 바뀌는 것이 이 방법의 뜻이라 저장하지 않는다(ADR 0067).
 */
import { canonicalDecimal, ratio, Temporal, type BidRate, type Clock, type Money, type Ratio } from "@eatbid/domain";

import type { RegisteredBusinessReader } from "../../account/application/registered-business-reader";
import type { UnitOfWork } from "../../../platform/database/unit-of-work";
import { positionsOf, type MarketPickPosition } from "../domain/market-position-pick";
import { habitCompetitors, habitField, sameDayCoverage, type HabitField } from "../domain/morning-habit-field";
import { habitFirmHistory, kstDayNumber, type HabitBidInput, type HabitFirmHistory } from "../domain/morning-habit-history";
import { HabitKeepRates, type HabitMarketRound } from "../domain/morning-habit-keep-rate";
import { MORNING_HABIT_PICK, type MorningHabitMethod } from "../domain/morning-habit-pick-table";
import { habitRegulars } from "../domain/morning-habit-regulars";
import { bestTickets, habitWinBasis, ticketWinTable, type HabitWinBasis } from "../domain/morning-habit-win-probability";
import { PLANNED_RATIO_DISTRIBUTION } from "../domain/planned-ratio-distribution-table";
import type { HabitFirmBidRecord, HabitMarketRoundRecord, MorningHabitReader } from "./morning-habit-reader";

export type MorningHabitNotApplicableReason =
  | "floor-rate-unobserved"
  | "floor-rate-outside-habit-pick"
  | "no-linked-business"
  | "market-rounds-below-minimum"
  | "market-data-unavailable"
  | "deadline-unobserved"
  | "deadline-passed"
  | "participation-unobserved"
  | "same-day-coverage-below-threshold";

const epochSeconds = (instant: Temporal.Instant) => Math.floor(instant.epochMilliseconds / 1000);
const instantOf = (seconds: number) => Temporal.Instant.fromEpochMilliseconds(seconds * 1000);

/** 마감일 하나의 단골 배치다. 낙찰 확률 기초 계산은 무거워 처음 쓰일 때 한 번만 한다. */
interface HabitDay {
  readonly field: HabitField;
  readonly coverage: number;
  readonly sameDayRegulars: number;
  /** 오늘 자리가 보인 단골 투찰 가운데 가장 늦은 개찰 시각이다. 오늘 것이 하나도 없으면 `null`이다. */
  readonly latestSameDayOpenedAt: Temporal.Instant | null;
  basis: HabitWinBasis | null;
}

/**
 * 결정 시각에 읽은 시장이다. 마감일별 배치를 기억해 같은 요청의 여러 공고가 다시 계산하지 않게 한다. 요청 밖으로 새지 않는다 —
 * 다음 요청은 새 결과를 봐야 한다.
 */
export class HabitMarket {
  private readonly days = new Map<number, HabitDay>();

  constructor(
    private readonly context: {
      readonly decisionAt: number;
      readonly rounds: readonly HabitMarketRound[];
      readonly histories: ReadonlyMap<string, HabitFirmHistory>;
      readonly regulars: readonly string[];
      readonly own: ReadonlySet<string>;
      readonly keepRates: HabitKeepRates;
      readonly method: MorningHabitMethod;
    },
  ) {}

  dayOf(deadlineAt: Temporal.Instant): HabitDay {
    const deadlineDay = kstDayNumber(epochSeconds(deadlineAt));
    const cached = this.days.get(deadlineDay);
    if (cached !== undefined) return cached;
    const field = habitField({ ...this.context, deadlineDay });
    const seen = field.regulars.filter((view) => view.anchor.kind !== "earlier");
    const latest = seen.length === 0 ? null : Math.max(...seen.map((view) => view.anchor.openedAt));
    const day: HabitDay = {
      field,
      coverage: sameDayCoverage(field),
      sameDayRegulars: seen.length,
      latestSameDayOpenedAt: latest === null ? null : instantOf(latest),
      basis: null,
    };
    this.days.set(deadlineDay, day);
    return day;
  }

  basisOf(day: HabitDay): HabitWinBasis {
    day.basis ??= habitWinBasis(habitCompetitors(day.field), this.context.method, PLANNED_RATIO_DISTRIBUTION);
    return day.basis;
  }
}

export type MorningHabitDecision =
  | {
    readonly kind: "ready";
    readonly method: MorningHabitMethod;
    readonly decidedAt: Temporal.Instant;
    readonly marketRounds: number;
    readonly regulars: number;
    readonly linkedBusinesses: number;
    readonly market: HabitMarket;
  }
  | {
    readonly kind: "not-applicable";
    readonly method: MorningHabitMethod;
    readonly decidedAt: Temporal.Instant;
    readonly reasons: readonly MorningHabitNotApplicableReason[];
    /** 시장을 읽지 못했으면(사업자 없음·하한율 밖·장애) `null`이다. */
    readonly marketRounds: number | null;
  };

function habitRoundOf(record: HabitMarketRoundRecord, method: MorningHabitMethod): HabitMarketRound {
  const openedAt = epochSeconds(record.openedAt);
  return {
    openedAt,
    deadlineAt: epochSeconds(record.deadlineAt),
    // 과거 회차의 실제 공개 시각은 수집 경로마다 달라 고르지 않다. 결과 전용 수집 줄 뒤의 기대 지연으로 둔다(방법 표).
    visibleAt: openedAt + method.trainingVisibilityLagSeconds,
    firms: record.bids.map((bid) => bid.supplierPartyId.toString()),
    ratios: record.bids.map((bid) => Number(bid.ratio)),
  };
}

/** 읽기가 업체·개찰·투찰 순으로 주므로 업체가 바뀌는 자리에서 끊는다. */
function historiesOf(records: readonly HabitFirmBidRecord[], method: MorningHabitMethod): Map<string, HabitFirmHistory> {
  const grouped = new Map<string, HabitBidInput[]>();
  for (const record of records) {
    const firm = record.supplierPartyId.toString();
    const openedAt = epochSeconds(record.openedAt);
    const bids = grouped.get(firm) ?? [];
    bids.push({
      openedAt,
      deadlineAt: epochSeconds(record.deadlineAt),
      visibleAt: openedAt + method.trainingVisibilityLagSeconds,
      ratio: Number(record.ratio),
    });
    grouped.set(firm, bids);
  }
  return new Map([...grouped].map(([firm, bids]) => [firm, habitFirmHistory(bids)]));
}

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
    const decisionAt = epochSeconds(decidedAt);
    const closed = (reasons: readonly MorningHabitNotApplicableReason[], marketRounds: number | null): MorningHabitDecision =>
      ({ kind: "not-applicable", method, decidedAt, reasons, marketRounds });
    if (input.floorRate === null) return closed(["floor-rate-unobserved"], null);
    if (input.floorRate !== undefined && input.floorRate !== method.floorRate) return closed(["floor-rate-outside-habit-pick"], null);
    // 단골을 정하는 창과 유지 확률을 배우는 창(공개 시각 기준) 가운데 넓은 쪽만큼 시장을 읽는다.
    const marketFrom = decidedAt.subtract({
      seconds: Math.max(method.regulars.lookbackSeconds, 2 * method.windowSeconds) + method.trainingVisibilityLagSeconds,
    });
    const floorRate = method.floorRate as BidRate;
    try {
      const read = await this.snapshot.run(async (snapshot) => {
        const businesses = await this.businesses.list(snapshot, input.workspaceId);
        const own = businesses.flatMap((business) =>
          business.supplier.kind === "linked" ? [business.supplier.supplierPartyId] : []);
        if (own.length === 0) return null;
        const records = await this.reader.findMarketRounds(snapshot, {
          supplierPartyIds: own, floorRate, openedFrom: marketFrom, openedBefore: decidedAt,
        });
        const rounds = records.map((record) => habitRoundOf(record, method));
        const ownSet = new Set(own.map((party) => party.toString()));
        const regulars = habitRegulars({ rounds, own: ownSet, decisionAt, method });
        if (regulars.kind === "too-few-rounds") return { own, ownSet, rounds, regulars, bids: [] };
        const bids = await this.reader.findFirmBids(snapshot, {
          supplierPartyIds: regulars.firms.map((firm) => BigInt(firm)),
          floorRate,
          openedFrom: marketFrom.subtract({ seconds: method.historyMarginSeconds }),
          openedBefore: decidedAt,
        });
        return { own, ownSet, rounds, regulars, bids };
      });
      if (read === null) return closed(["no-linked-business"], null);
      if (read.regulars.kind === "too-few-rounds") return closed(["market-rounds-below-minimum"], read.regulars.marketRounds);
      const histories = historiesOf(read.bids, method);
      const keepRates = HabitKeepRates.learn({ rounds: read.rounds, histories, regulars: read.regulars.firms, method });
      return {
        kind: "ready",
        method,
        decidedAt,
        marketRounds: read.regulars.marketRounds,
        regulars: read.regulars.firms.length,
        linkedBusinesses: read.own.length,
        market: new HabitMarket({
          decisionAt, rounds: read.rounds, histories, regulars: read.regulars.firms, own: read.ownSet, keepRates, method,
        }),
      };
    } catch {
      return closed(["market-data-unavailable"], null);
    }
  }
}

export type MorningHabitPickResult =
  | {
    readonly state: "applicable";
    readonly decidedAt: Temporal.Instant;
    /** 단골 참여율로 가중한, 오늘 자리가 보인 단골의 몫이다(소수 넷째 자리). */
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

const coverageRatio = (value: number) => ratio(canonicalDecimal(value.toFixed(4), 4));

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
