import { describe, expect, test } from "bun:test";
import { MORNING_HABIT_FIXTURE as FIXTURE } from "./__fixtures__/morning-habit";
import { habitFirmHistory, kstDayNumber, type HabitFirmHistory } from "./morning-habit-history";
import { HabitKeepRates, type HabitMarketRound } from "./morning-habit-keep-rate";
import { habitCompetitors, habitField, sameDayCoverage } from "./morning-habit-field";
import { bestTickets, habitWinBasis, ticketWinTable } from "./morning-habit-win-probability";
import { MORNING_HABIT_PICK as METHOD } from "./morning-habit-pick-table";
import { PLANNED_RATIO_DISTRIBUTION } from "./planned-ratio-distribution-table";

const epoch = (minute: number) => FIXTURE.startEpochSeconds + minute * 60;
const lag = METHOD.trainingVisibilityLagSeconds;

const histories = new Map<string, HabitFirmHistory>(Object.entries(FIXTURE.histories).map(([firm, bids]) => [
  firm,
  habitFirmHistory(bids.map(([opened, deadline, ratio]) => ({
    openedAt: epoch(opened), deadlineAt: epoch(deadline), visibleAt: epoch(opened) + lag, ratio,
  }))),
]));

const rounds: HabitMarketRound[] = FIXTURE.market.map(([opened, deadline, firms, ratios]) => ({
  openedAt: epoch(opened), deadlineAt: epoch(deadline), visibleAt: epoch(opened) + lag, firms, ratios,
}));

const keepRates = HabitKeepRates.learn({ rounds, histories, regulars: FIXTURE.regulars, method: METHOD });

/** 분석 엔진처럼 대상 공고의 마감 10분 전을 결정 시각으로 둔다. */
const targets = FIXTURE.expected.map((expected) => {
  const deadlineAt = epoch(expected.deadlineMinute);
  const field = habitField({
    rounds, histories, regulars: FIXTURE.regulars, own: new Set(FIXTURE.own), keepRates, method: METHOD,
    decisionAt: deadlineAt - METHOD.trainingDecisionLeadSeconds, deadlineDay: kstDayNumber(deadlineAt),
  });
  return { expected, field };
});

describe("아침 습관 맞춤 — 분석 엔진(numpy)과 같은 답", () => {
  test("결정 시각 전에 보인 최근 90일 시장 공고와 비단골 투찰 수가 같다", () => {
    for (const { expected, field } of targets) {
      expect({ rounds: field.recentRounds, nonRegular: field.nonRegularRatios.length })
        .toEqual({ rounds: expected.recentRounds, nonRegular: expected.nonRegularRatios });
    }
  });

  test("단골마다 참여율·오늘 기준 배수와 갈래·유지 확률·최근 배수 수가 같다", () => {
    for (const { expected, field } of targets) {
      expect(field.regulars.map((view) => ({
        firm: view.firm,
        participation: view.participation,
        anchor: view.anchor.ratio,
        kind: view.anchor.kind,
        keepRate: view.keepRate,
        recentRatios: view.recentRatios.length,
      }))).toEqual(expected.regulars.map((view) => ({ ...view })));
    }
  });

  test("결정 시각과 같은 초에 보이게 된 오늘 투찰은 쓰지 않는다", () => {
    // 마지막 대상은 101번이 결정 시각에 정확히 보이게 되는 같은 날 투찰을 가진다. 분석은 그것을 보지 않아 '이전'으로 둔다.
    const boundary = targets.at(-1)!;
    expect(boundary.field.regulars.find((view) => view.firm === "101")?.anchor.kind).toBe("earlier");
  });

  test("참여율로 가중한 오늘 정보 덮임이 같다", () => {
    for (const { expected, field } of targets) {
      expect(sameDayCoverage(field)).toBeCloseTo(expected.coverage, 12);
    }
  });

  test("두 장과 한 장에서 같은 배수를 고르고 낙찰 확률도 같다", () => {
    for (const { expected, field } of targets) {
      const table = ticketWinTable(habitWinBasis(habitCompetitors(field), METHOD, PLANNED_RATIO_DISTRIBUTION), expected.competitorCount);
      const pair = bestTickets(table, 2);
      const single = bestTickets(table, 1);
      expect(pair.multiples).toEqual([...expected.pair]);
      expect(pair.winProbability).toBeCloseTo(expected.pairWin, 9);
      expect(single.multiples).toEqual([expected.single]);
      expect(single.winProbability).toBeCloseTo(expected.singleWin, 9);
    }
  });

  test("같은 마감일의 단골 계산을 참여 수만 바꿔 다시 써도 공고마다 처음부터 계산한 값과 같다", () => {
    const { field } = targets[2]!;
    const shared = habitWinBasis(habitCompetitors(field), METHOD, PLANNED_RATIO_DISTRIBUTION);
    for (const count of [3, 9, 14]) {
      const fresh = habitWinBasis(habitCompetitors(field), METHOD, PLANNED_RATIO_DISTRIBUTION);
      expect(ticketWinTable(shared, count).pair).toEqual(ticketWinTable(fresh, count).pair);
    }
  });

  test("참여 수가 단골 기대 참여보다 적으면 비단골을 더하지 않는다", () => {
    const { field } = targets[2]!;
    const basis = habitWinBasis(habitCompetitors(field), METHOD, PLANNED_RATIO_DISTRIBUTION);
    expect(ticketWinTable(basis, 0).pair).toEqual(ticketWinTable(basis, 1).pair);
  });
});
