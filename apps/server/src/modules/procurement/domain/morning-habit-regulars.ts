/**
 * @module 책임: 아침 습관 맞춤이 습관을 읽을 "단골 업체"를 결정 시각 전 시장 공고만으로 정하는 규칙을 소유한다.
 *
 * 분석은 전 기간을 보고 고른 고정 60곳을 썼다. 그 목록은 뒤의 공고까지 보고 고른 것이고 업체 번호를 코드에 둘 수도 없어서,
 * 서버는 결정 시각마다 같은 규칙으로 다시 정한다. 이 규칙으로 1,204건을 다시 채점한 성적이 이 계산의 근거다(ADR 0067).
 */
import { lowerBound } from "./morning-habit-history";
import type { HabitMarketRound } from "./morning-habit-keep-rate";
import type { MorningHabitMethod } from "./morning-habit-pick-table";

export type HabitRegulars =
  | { readonly kind: "decided"; readonly firms: readonly string[]; readonly marketRounds: number }
  | { readonly kind: "too-few-rounds"; readonly marketRounds: number };

/**
 * 결정 시각 전 `lookbackSeconds` 안에 개찰되어 보인 시장 공고의 `minimumShare` 이상에 나온 업체다(우리 업체 제외). 공고가
 * `minimumRounds`보다 적으면 몫이 흔들려 정하지 않는다. `rounds`는 개찰 순이어야 한다. 순서는 업체 번호 순이다.
 */
export function habitRegulars(input: {
  readonly rounds: readonly HabitMarketRound[];
  readonly own: ReadonlySet<string>;
  readonly decisionAt: number;
  readonly method: MorningHabitMethod;
}): HabitRegulars {
  const { regulars } = input.method;
  const opened = input.rounds.map((round) => round.openedAt);
  const window = input.rounds
    .slice(lowerBound(opened, input.decisionAt - regulars.lookbackSeconds), lowerBound(opened, input.decisionAt))
    .filter((round) => round.visibleAt < input.decisionAt);
  if (window.length < regulars.minimumRounds) return { kind: "too-few-rounds", marketRounds: window.length };
  const counts = new Map<string, number>();
  for (const round of window) for (const firm of new Set(round.firms)) counts.set(firm, (counts.get(firm) ?? 0) + 1);
  const firms = [...counts]
    .filter(([firm, count]) => !input.own.has(firm) && count >= regulars.minimumShare * window.length)
    .map(([firm]) => firm)
    .sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0));
  return { kind: "decided", firms, marketRounds: window.length };
}
