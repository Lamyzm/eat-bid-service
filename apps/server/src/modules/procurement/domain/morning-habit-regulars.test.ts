import { describe, expect, test } from "bun:test";
import type { HabitMarketRound } from "./morning-habit-keep-rate";
import { MORNING_HABIT_PICK as METHOD } from "./morning-habit-pick-table";
import { habitRegulars } from "./morning-habit-regulars";

const DAY = 86_400;
const decisionAt = 1_800_000_000;

/** 결정 시각 전 `daysBefore`일에 개찰한 공고다. 결과는 개찰 20분 뒤 보인다. */
function round(daysBefore: number, firms: readonly string[]): HabitMarketRound {
  const openedAt = decisionAt - daysBefore * DAY;
  return { openedAt, deadlineAt: openedAt - 3600, visibleAt: openedAt + 1200, firms, ratios: firms.map(() => 1) };
}

/** 하루 간격 공고 `count`건. `firmsOf(i)`가 i번째 공고(오래된 순)의 업체다. */
function rounds(count: number, firmsOf: (index: number) => readonly string[]): HabitMarketRound[] {
  return Array.from({ length: count }, (_, index) => round(count - index, firmsOf(index)));
}

const decide = (market: readonly HabitMarketRound[]) =>
  habitRegulars({ rounds: market, own: new Set(["1"]), decisionAt, method: METHOD });

describe("아침 습관 단골 정하기", () => {
  test("180일 시장 공고의 30% 이상에 나온 업체를 업체 번호 순으로 고르고 우리 업체는 뺀다", () => {
    // 40건 중 "30"은 12건(30%), "29"는 11건(27.5%), "100"은 전부, "1"(우리)도 전부 나온다.
    const market = rounds(40, (index) => ["1", "100", ...(index < 12 ? ["30"] : []), ...(index < 11 ? ["29"] : [])]);
    expect(decide(market)).toEqual({ kind: "decided", firms: ["30", "100"], marketRounds: 40 });
  });

  test("한 공고에 두 번 나와도 한 번으로 센다", () => {
    const market = rounds(40, (index) => (index < 6 ? ["7", "7"] : ["8"]));
    expect(decide(market)).toEqual({ kind: "decided", firms: ["8"], marketRounds: 40 });
  });

  test("180일보다 오래된 공고와 결정 시각까지 결과가 안 보인 공고는 세지 않는다", () => {
    const old = Array.from({ length: 20 }, () => round(181, ["9"]));
    const hidden = { ...round(0.01, ["9"]), visibleAt: decisionAt };
    const market = [...old, ...rounds(30, () => ["8"]), hidden];
    expect(decide(market)).toEqual({ kind: "decided", firms: ["8"], marketRounds: 30 });
  });

  test("보인 시장 공고가 30건보다 적으면 단골을 정하지 않는다", () => {
    expect(decide(rounds(29, () => ["8"]))).toEqual({ kind: "too-few-rounds", marketRounds: 29 });
  });
});
