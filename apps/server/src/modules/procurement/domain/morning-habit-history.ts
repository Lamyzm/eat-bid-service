/**
 * @module 책임: 아침 습관 맞춤이 읽는 업체 한 곳의 투찰 이력과, 결정 시각에 그 업체의 "오늘 자리"가 무엇으로 보였는지 가르는
 * 규칙을 소유한다.
 *
 * 시각은 epoch 초 정수다. 이 계산은 공고 하나에 이력을 수만 번 훑으므로 Temporal 값을 들고 다니지 않고 경계(use case)에서 한 번
 * 바꾼다. "보였다"는 결정 시각보다 앞서(같은 초는 빼고) 개찰되고 공개된 것이다. 분석 엔진의 결정 시각(마감 − 0.16666667시간,
 * 즉 600.000012초 전)이 정수 초에서 뜻하는 바와 같다 — 그래서 위끝은 언제나 미만, 아래끝은 이상으로 자른다.
 */

const DAY_SECONDS = 86_400;
const KST_OFFSET_SECONDS = 9 * 3600;

/** 마감이 속한 KST 달력일 번호다. 같은 날 묶음은 개찰일이 아니라 마감일로 가른다 — 분석 엔진과 같다. */
export function kstDayNumber(epochSeconds: number): number {
  return Math.floor((epochSeconds + KST_OFFSET_SECONDS) / DAY_SECONDS);
}

export interface HabitBidInput {
  readonly openedAt: number;
  readonly deadlineAt: number;
  /** 이 투찰이 우리에게 보이게 된(될) 시각이다. */
  readonly visibleAt: number;
  /** 투찰 금액 ÷ (기초금액 × 낙찰하한율)이다. */
  readonly ratio: number;
}

export interface HabitFirmHistory {
  readonly openedAt: Float64Array;
  readonly visibleAt: Float64Array;
  readonly deadlineDay: Int32Array;
  readonly ratio: Float64Array;
}

/**
 * 개찰 순(같으면 투찰 순)으로 받은 이력을 색인으로 바꾼다. "마지막으로 보인 자리"가 이 순서로 정해지므로 순서가 틀리면
 * 다른 업체 자리를 고른다 — 그래서 정렬은 읽기에서 하고 여기서는 어긋나면 거부한다.
 */
export function habitFirmHistory(bids: readonly HabitBidInput[]): HabitFirmHistory {
  const history = {
    openedAt: new Float64Array(bids.length),
    visibleAt: new Float64Array(bids.length),
    deadlineDay: new Int32Array(bids.length),
    ratio: new Float64Array(bids.length),
  };
  bids.forEach((bid, index) => {
    if (index > 0 && bid.openedAt < bids[index - 1]!.openedAt) throw new RangeError("습관 이력은 개찰 순이어야 한다");
    history.openedAt[index] = bid.openedAt;
    history.visibleAt[index] = bid.visibleAt;
    history.deadlineDay[index] = kstDayNumber(bid.deadlineAt);
    history.ratio[index] = bid.ratio;
  });
  return history;
}

/** `values[index] >= bound`인 첫 위치다(오름차순 배열). */
export function lowerBound(values: ArrayLike<number>, bound: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < bound) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * 오늘 자리의 갈래다. `single` 오늘 하나 보임, `repeated` 오늘 여럿이 모두 같은 자리, `mixed` 오늘 여럿이 서로 다른 자리,
 * `earlier` 오늘 것은 안 보이고 그 전 것만 보임. 갈래마다 그 자리를 다음 공고에도 지키는 비율이 달라 따로 배운다.
 */
export type SameDayKind = "single" | "repeated" | "mixed" | "earlier";

export interface SameDayAnchor {
  /** 기준 자리다. 오늘 것이 보이면 오늘 마지막으로 보인 자리, 아니면 마지막으로 보인 자리다. */
  readonly ratio: number;
  readonly kind: SameDayKind;
  /** 오늘 보인 자리들이다(보인 순). `earlier`면 비어 있다. */
  readonly sameDayRatios: readonly number[];
}

/** 결정 시각에 보인 이력으로 오늘 자리를 정한다. 보인 투찰이 하나도 없으면 `null`이다. */
export function sameDayAnchor(
  history: HabitFirmHistory,
  input: { readonly decisionAt: number; readonly deadlineDay: number; readonly keepTolerance: number },
): SameDayAnchor | null {
  const end = lowerBound(history.openedAt, input.decisionAt);
  let last = -1;
  const sameDay: number[] = [];
  for (let index = 0; index < end; index += 1) {
    if (history.visibleAt[index]! >= input.decisionAt) continue;
    last = index;
    if (history.deadlineDay[index] === input.deadlineDay) sameDay.push(index);
  }
  if (last < 0) return null;
  if (sameDay.length === 0) return { ratio: history.ratio[last]!, kind: "earlier", sameDayRatios: [] };
  const ratios = sameDay.map((index) => history.ratio[index]!);
  const anchor = history.ratio[sameDay.at(-1)!]!;
  if (ratios.length === 1) return { ratio: anchor, kind: "single", sameDayRatios: ratios };
  const kind = ratios.every((ratio) => Math.abs(ratio - ratios[0]!) < input.keepTolerance) ? "repeated" : "mixed";
  return { ratio: anchor, kind, sameDayRatios: ratios };
}

/** 결정 시각 전 `windowSeconds` 안에 개찰되어 보인 자리들이다(개찰 순). 오늘 자리를 지키지 않을 때 이 안에서 고른다고 본다. */
export function recentVisibleRatios(
  history: HabitFirmHistory,
  input: { readonly decisionAt: number; readonly windowSeconds: number },
): number[] {
  const from = lowerBound(history.openedAt, input.decisionAt - input.windowSeconds);
  const end = lowerBound(history.openedAt, input.decisionAt);
  const ratios: number[] = [];
  for (let index = from; index < end; index += 1) {
    if (history.visibleAt[index]! < input.decisionAt) ratios.push(history.ratio[index]!);
  }
  return ratios;
}
