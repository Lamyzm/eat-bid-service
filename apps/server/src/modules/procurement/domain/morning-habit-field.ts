/**
 * @module 책임: 결정 시각에 보인 것만으로 공고 하나의 경쟁 배치(단골마다 참여율·오늘 자리·유지 확률·최근 자리, 비단골 자리 묶음)를
 * 세우고, 그것을 낙찰 확률 계산이 받는 경쟁 성분으로 바꾸는 일을 소유한다.
 *
 * 단골 한 곳은 참여율만큼 나오고, 나오면 유지 확률만큼 오늘 자리를, 나머지는 최근 90일 자리 가운데 하나를 넣는다고 본다.
 * 참여 수에서 단골의 기대 참여를 뺀 나머지는 최근 시장의 비단골 자리에서 고르게 뽑는다고 본다(분석 엔진 v2s와 같다).
 */
import { lowerBound, recentVisibleRatios, sameDayAnchor, type HabitFirmHistory, type SameDayAnchor } from "./morning-habit-history";
import type { HabitKeepRates, HabitMarketRound } from "./morning-habit-keep-rate";
import type { MorningHabitMethod } from "./morning-habit-pick-table";

export interface HabitRegularView {
  readonly firm: string;
  /** 결정 시각 전 90일 안에 보인 시장 공고 가운데 이 업체가 나온 몫이다. */
  readonly participation: number;
  readonly anchor: SameDayAnchor;
  readonly keepRate: number;
  readonly recentRatios: readonly number[];
}

export interface HabitField {
  /** 보인 이력이 하나라도 있는 단골만 담는다. */
  readonly regulars: readonly HabitRegularView[];
  readonly nonRegularRatios: readonly number[];
  readonly recentRounds: number;
}

/** 낙찰 확률 계산이 받는 경쟁 성분이다. 자리 `values[i]`에 확률 `weights[i]`로 나오는 업체 `multiplicity`곳이다. */
export interface CompetitorComponent {
  readonly values: readonly number[];
  readonly weights: readonly number[];
  readonly multiplicity: number;
}

/** `rounds`는 개찰 순이어야 한다. */
export function habitField(input: {
  readonly rounds: readonly HabitMarketRound[];
  readonly histories: ReadonlyMap<string, HabitFirmHistory>;
  readonly regulars: readonly string[];
  readonly own: ReadonlySet<string>;
  readonly keepRates: HabitKeepRates;
  readonly decisionAt: number;
  readonly deadlineDay: number;
  readonly method: MorningHabitMethod;
}): HabitField {
  const { decisionAt, method } = input;
  const opened = input.rounds.map((round) => round.openedAt);
  const recent = input.rounds
    .slice(lowerBound(opened, decisionAt - method.windowSeconds), lowerBound(opened, decisionAt))
    .filter((round) => round.visibleAt < decisionAt);
  const regularSet = new Set(input.regulars);
  const presence = new Map(input.regulars.map((firm) => [firm, 0]));
  const nonRegularRatios: number[] = [];
  for (const round of recent) {
    const present = new Set(round.firms);
    for (const firm of input.regulars) if (present.has(firm)) presence.set(firm, presence.get(firm)! + 1);
    round.firms.forEach((firm, index) => {
      if (!regularSet.has(firm) && !input.own.has(firm)) nonRegularRatios.push(round.ratios[index]!);
    });
  }
  const regulars: HabitRegularView[] = [];
  for (const firm of input.regulars) {
    const history = input.histories.get(firm);
    if (history === undefined) continue;
    const anchor = sameDayAnchor(history, { decisionAt, deadlineDay: input.deadlineDay, keepTolerance: method.keepTolerance });
    if (anchor === null) continue;
    regulars.push({
      firm,
      participation: presence.get(firm)! / Math.max(recent.length, 1),
      anchor,
      keepRate: input.keepRates.rate({ firm, kind: anchor.kind, decisionAt }),
      recentRatios: recentVisibleRatios(history, { decisionAt, windowSeconds: method.windowSeconds }),
    });
  }
  return { regulars, nonRegularRatios, recentRounds: recent.length };
}

/** 단골 참여율로 가중한, 오늘 자리가 보인 단골의 몫이다. 이 값이 문턱보다 낮으면 "오늘 정보가 아직 모자란" 공고다. */
export function sameDayCoverage(field: HabitField): number {
  let total = 0;
  let seen = 0;
  for (const view of field.regulars) {
    total += view.participation;
    if (view.anchor.kind !== "earlier") seen += view.participation;
  }
  return seen / Math.max(total, 1e-9);
}

/** numpy `round(x, 9)`처럼 반올림하되 정확히 반이면 짝수 쪽으로 보낸다. 오늘 자리 묶음이 분석과 같은 칸으로 묶이게 한다. */
function roundNine(value: number): number {
  const scaled = value * 1e9;
  let rounded = Math.round(scaled);
  if (rounded - scaled === 0.5 && rounded % 2 !== 0) rounded -= 1;
  return rounded / 1e9;
}

function regularComponent(view: HabitRegularView): CompetitorComponent {
  const { participation: share, keepRate: keep, anchor, recentRatios: recent } = view;
  let headValues: number[];
  let headWeights: number[];
  if (anchor.kind === "mixed") {
    const counts = new Map<number, number>();
    for (const ratio of anchor.sameDayRatios) counts.set(roundNine(ratio), (counts.get(roundNine(ratio)) ?? 0) + 1);
    headValues = [...counts.keys()].sort((left, right) => left - right);
    headWeights = headValues.map((value) => share * keep * counts.get(value)! / anchor.sameDayRatios.length);
  } else {
    headValues = [anchor.ratio];
    headWeights = [share * keep];
  }
  // 최근 자리가 없으면 나올 때 언제나 오늘 자리를 넣는다고 본다.
  if (recent.length === 0) {
    return { values: headValues, weights: headWeights.map((weight) => weight / Math.max(keep, 1e-9)), multiplicity: 1 };
  }
  const spread = share * (1 - keep) / recent.length;
  return { values: [...headValues, ...recent], weights: [...headWeights, ...recent.map(() => spread)], multiplicity: 1 };
}

/**
 * 공고 하나의 경쟁자다. 단골은 마감일마다 같지만 비단골 수는 공고의 참여 수에 달려 있어 묶음으로만 넘긴다 — 참여 수에서 단골
 * 기대 참여(`expectedRegulars`)를 뺀 만큼이 비단골 자리 묶음에서 고르게 뽑힌다(낙찰 확률 계산이 공고마다 더한다).
 */
export interface HabitCompetitors {
  readonly regulars: readonly CompetitorComponent[];
  readonly nonRegularPool: readonly number[];
  readonly expectedRegulars: number;
}

export function habitCompetitors(field: HabitField): HabitCompetitors {
  let expectedRegulars = 0;
  for (const view of field.regulars) expectedRegulars += view.participation;
  return { regulars: field.regulars.map(regularComponent), nonRegularPool: field.nonRegularRatios, expectedRegulars };
}
