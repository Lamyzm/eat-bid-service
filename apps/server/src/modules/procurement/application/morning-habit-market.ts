/**
 * @module 책임: 결정 시각 하나에 보이던 시장(창 안 회차와 단골 이력)으로 단골·유지 확률·마감일별 배치를 세워 아침 습관 결정을 만드는
 * 계산을 소유한다. 오늘 화면(요청 시각)과 복기(지난 공고의 마감 10분 전)가 같은 계산을 쓴다 — 시각만 다르고 규칙은 하나다.
 */
import { Temporal } from "@eatbid/domain";

import { habitCompetitors, habitField, sameDayCoverage, type HabitField } from "../domain/morning-habit-field";
import { habitFirmHistory, kstDayNumber, lowerBound, type HabitBidInput, type HabitFirmHistory } from "../domain/morning-habit-history";
import { HabitKeepRates, type HabitMarketRound } from "../domain/morning-habit-keep-rate";
import type { MorningHabitMethod } from "../domain/morning-habit-pick-table";
import { habitRegulars, type HabitRegulars } from "../domain/morning-habit-regulars";
import { habitWinBasis, type HabitWinBasis } from "../domain/morning-habit-win-probability";
import { PLANNED_RATIO_DISTRIBUTION } from "../domain/planned-ratio-distribution-table";
import type { HabitFirmBidRecord, HabitMarketRoundRecord } from "./morning-habit-reader";

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

export const epochSeconds = (instant: Temporal.Instant) => Math.floor(instant.epochMilliseconds / 1000);
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

/**
 * 결정 시각 하나가 읽는 창이다. 시장은 단골을 정하는 창과 유지 확률을 배우는 창(공개 시각 기준) 가운데 넓은 쪽만큼, 단골 이력은
 * 거기서 여유만큼 더 앞에서부터 읽는다. 둘 다 결정 시각 직전까지다.
 */
export function habitWindowsAt(method: MorningHabitMethod, decidedAt: Temporal.Instant) {
  const marketFrom = decidedAt.subtract({
    seconds: Math.max(method.regulars.lookbackSeconds, 2 * method.windowSeconds) + method.trainingVisibilityLagSeconds,
  });
  return { marketFrom, historyFrom: marketFrom.subtract({ seconds: method.historyMarginSeconds }), before: decidedAt };
}

/** 읽기가 준 순서(개찰 순, 업체·개찰·투찰 순)를 그대로 쓴다. 자르기는 그 순서 위의 이분 탐색이다. */
const millis = (instant: Temporal.Instant) => instant.epochMilliseconds;

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

function bidInputOf(record: HabitFirmBidRecord, method: MorningHabitMethod): HabitBidInput {
  const openedAt = epochSeconds(record.openedAt);
  return {
    openedAt,
    deadlineAt: epochSeconds(record.deadlineAt),
    visibleAt: openedAt + method.trainingVisibilityLagSeconds,
    ratio: Number(record.ratio),
  };
}

/** 결정 시각 하나에서 고른 단골이다. */
export interface HabitMarketAt {
  readonly decidedAt: Temporal.Instant;
  readonly rounds: readonly HabitMarketRound[];
  readonly regulars: HabitRegulars;
}

/**
 * 한 번 읽은 시장 회차를 결정 시각마다 그 시각의 창(`habitWindowsAt`)으로 자르는 색인이다. 회차는 한 번만 바꾸고 읽기가 준 개찰
 * 순서 위에서 이분 탐색한다 — 여러 시각을 한 번에 골라도(복기) 시각 하나씩 읽은 것(오늘 화면)과 같은 회차를 본다.
 */
export class HabitMarketIndex {
  private readonly rounds: readonly HabitMarketRound[];
  private readonly opened: readonly number[];

  constructor(private readonly method: MorningHabitMethod, records: readonly HabitMarketRoundRecord[]) {
    this.rounds = records.map((record) => habitRoundOf(record, method));
    this.opened = records.map((record) => millis(record.openedAt));
  }

  marketAt(decidedAt: Temporal.Instant, own: ReadonlySet<string>): HabitMarketAt {
    const { marketFrom, before } = habitWindowsAt(this.method, decidedAt);
    const rounds = this.rounds.slice(lowerBound(this.opened, millis(marketFrom)), lowerBound(this.opened, millis(before)));
    const regulars = habitRegulars({ rounds, own, decisionAt: epochSeconds(decidedAt), method: this.method });
    return { decidedAt, rounds, regulars };
  }
}

/**
 * 한 번 읽은 단골 이력을 결정 시각마다 그 시각의 창으로 자르는 색인이다. 업체 이력은 같은 조각(같은 처음·끝)이면 다시 묶지
 * 않는다 — 이력 묶기는 그 조각만의 함수라 결과가 같고, 같은 날 시각들은 조각이 거의 같다.
 */
export class HabitHistoryIndex {
  private readonly firms = new Map<string, { readonly opened: number[]; readonly inputs: HabitBidInput[] }>();
  private readonly built = new Map<string, HabitFirmHistory>();

  constructor(private readonly method: MorningHabitMethod, bids: readonly HabitFirmBidRecord[]) {
    for (const bid of bids) {
      const firm = bid.supplierPartyId.toString();
      const entry = this.firms.get(firm) ?? { opened: [], inputs: [] };
      entry.opened.push(millis(bid.openedAt));
      entry.inputs.push(bidInputOf(bid, method));
      this.firms.set(firm, entry);
    }
  }

  /** 단골 순서(업체 번호 순)대로, 창 안에 투찰이 있는 업체만 담는다 — 읽기를 업체 순으로 묶었을 때와 같다. */
  historiesAt(decidedAt: Temporal.Instant, firms: readonly string[]): Map<string, HabitFirmHistory> {
    const { historyFrom, before } = habitWindowsAt(this.method, decidedAt);
    const histories = new Map<string, HabitFirmHistory>();
    for (const firm of firms) {
      const entry = this.firms.get(firm);
      if (entry === undefined) continue;
      const from = lowerBound(entry.opened, millis(historyFrom));
      const until = lowerBound(entry.opened, millis(before));
      if (from === until) continue;
      const key = `${firm}:${from}:${until}`;
      let history = this.built.get(key);
      if (history === undefined) {
        history = habitFirmHistory(entry.inputs.slice(from, until));
        this.built.set(key, history);
      }
      histories.set(firm, history);
    }
    return histories;
  }
}

/** 단골이 정해진 결정 시각 하나의 결정을 세운다. */
export function habitDecisionOf(input: {
  readonly method: MorningHabitMethod;
  readonly at: HabitMarketAt & { readonly regulars: Extract<HabitRegulars, { kind: "decided" }> };
  readonly histories: HabitHistoryIndex;
  readonly own: ReadonlySet<string>;
  readonly linkedBusinesses: number;
}): MorningHabitDecision {
  const { method, at } = input;
  const histories = input.histories.historiesAt(at.decidedAt, at.regulars.firms);
  const keepRates = HabitKeepRates.learn({ rounds: at.rounds, histories, regulars: at.regulars.firms, method });
  return {
    kind: "ready",
    method,
    decidedAt: at.decidedAt,
    marketRounds: at.regulars.marketRounds,
    regulars: at.regulars.firms.length,
    linkedBusinesses: input.linkedBusinesses,
    market: new HabitMarket({
      decisionAt: epochSeconds(at.decidedAt),
      rounds: at.rounds,
      histories,
      regulars: at.regulars.firms,
      own: input.own,
      keepRates,
      method,
    }),
  };
}
