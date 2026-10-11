/**
 * @module 책임: 단골 업체가 "오늘 보인 자리"를 다음 시장 공고에도 그대로 넣는 비율(유지 확률)을 과거 시장 공고에서 배우고,
 * 결정 시각 전 기록만으로 업체·갈래별 값을 내는 일을 소유한다.
 *
 * 과거 공고마다 그 공고의 결정 시각에 보였을 자리와 실제로 넣은 자리를 견준 기록 하나를 남긴다. 그 기록은 그 공고의 결과가
 * 공개된 뒤에야 배울 수 있으므로 공개 시각으로 줄 세워 결정 시각 전 것만 센다(정보 누수 방지, 분석 엔진과 같다).
 */
import { kstDayNumber, lowerBound, sameDayAnchor, type HabitFirmHistory, type SameDayKind } from "./morning-habit-history";
import type { MorningHabitMethod } from "./morning-habit-pick-table";

/** 시장 공고 한 건이다. `firms[i]`가 `ratios[i]`를 넣었다. 시각은 epoch 초다. */
export interface HabitMarketRound {
  readonly openedAt: number;
  readonly deadlineAt: number;
  readonly visibleAt: number;
  readonly firms: readonly string[];
  readonly ratios: readonly number[];
}

const KINDS: readonly SameDayKind[] = ["single", "repeated", "mixed", "earlier"];

/** 공개 시각 순 기록과 지킨 횟수의 누적합이다. 창 안 합을 이분 탐색 두 번으로 낸다. */
interface KeepSeries {
  readonly times: Float64Array;
  readonly keptBefore: Float64Array;
}

function seriesOf(records: readonly (readonly [number, number])[]): KeepSeries {
  // 분석 엔진은 (시각, 지킴) 순으로 정렬한다. 같은 시각 안 순서는 합에 영향이 없지만 같은 순서를 지킨다.
  const sorted = [...records].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const times = new Float64Array(sorted.length);
  const keptBefore = new Float64Array(sorted.length + 1);
  sorted.forEach(([time, kept], index) => {
    times[index] = time;
    keptBefore[index + 1] = keptBefore[index]! + kept;
  });
  return { times, keptBefore };
}

function windowCount(series: KeepSeries, from: number, before: number): { readonly kept: number; readonly total: number } {
  const start = lowerBound(series.times, from);
  const end = lowerBound(series.times, before);
  return { kept: series.keptBefore[end]! - series.keptBefore[start]!, total: end - start };
}

export class HabitKeepRates {
  private constructor(
    private readonly series: ReadonlyMap<string, Readonly<Record<SameDayKind, KeepSeries>>>,
    private readonly method: MorningHabitMethod,
  ) {}

  /**
   * `regulars`의 기록만 배운다. 전체 비율도 이 업체들의 기록으로만 낸다 — 비단골은 이 계산에서 습관을 보지 않는다.
   * 과거 공고의 결정 시각은 마감 − `trainingDecisionLeadSeconds`다.
   */
  static learn(input: {
    readonly rounds: readonly HabitMarketRound[];
    readonly histories: ReadonlyMap<string, HabitFirmHistory>;
    readonly regulars: readonly string[];
    readonly method: MorningHabitMethod;
  }): HabitKeepRates {
    const { method } = input;
    const records = new Map(input.regulars.map((firm) =>
      [firm, Object.fromEntries(KINDS.map((kind) => [kind, [] as [number, number][]])) as Record<SameDayKind, [number, number][]>]));
    for (const round of input.rounds) {
      const decisionAt = round.deadlineAt - method.trainingDecisionLeadSeconds;
      const deadlineDay = kstDayNumber(round.deadlineAt);
      round.firms.forEach((firm, index) => {
        const firmRecords = records.get(firm);
        const history = input.histories.get(firm);
        if (firmRecords === undefined || history === undefined) return;
        const anchor = sameDayAnchor(history, { decisionAt, deadlineDay, keepTolerance: method.keepTolerance });
        if (anchor === null) return;
        const ratio = round.ratios[index]!;
        // 오늘 자리가 섞여 있으면 그중 하나라도 다시 넣었으면 지킨 것으로 센다.
        const kept = anchor.kind === "mixed"
          ? anchor.sameDayRatios.some((value) => Math.abs(value - ratio) < method.keepTolerance)
          : Math.abs(ratio - anchor.ratio) < method.keepTolerance;
        firmRecords[anchor.kind].push([round.visibleAt, kept ? 1 : 0]);
      });
    }
    const series = new Map([...records].map(([firm, byKind]) =>
      [firm, Object.fromEntries(KINDS.map((kind) => [kind, seriesOf(byKind[kind])])) as Record<SameDayKind, KeepSeries>]));
    return new HabitKeepRates(series, method);
  }

  /**
   * 결정 시각 전 `2 × windowSeconds` 안의 기록으로 낸다. 업체 기록이 적으면 전체 비율 쪽으로 당긴다(가상 표본
   * `shrinkWeight`개). 전체 기록도 적으면 전체 비율 대신 고정값을 쓴다.
   */
  rate(input: { readonly firm: string; readonly kind: SameDayKind; readonly decisionAt: number }): number {
    const { method } = this;
    const from = input.decisionAt - 2 * method.windowSeconds;
    let kept = 0;
    let total = 0;
    for (const byKind of this.series.values()) {
      const count = windowCount(byKind[input.kind], from, input.decisionAt);
      kept += count.kept;
      total += count.total;
    }
    const overall = total >= method.globalMinimumRecords ? kept / total : method.globalFallbackKeepRate;
    const own = this.series.get(input.firm);
    const firm = own === undefined ? { kept: 0, total: 0 } : windowCount(own[input.kind], from, input.decisionAt);
    return (firm.kept + method.shrinkWeight * overall) / (firm.total + method.shrinkWeight);
  }
}
