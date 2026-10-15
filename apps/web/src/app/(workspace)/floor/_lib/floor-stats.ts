/**
 * @module 책임: 하한선 점 목록에서 달별 가장 많이 나온 칸, 같은 달 앞서 몰린 칸 따라가기, 지난달 칸 따라가기와 그 순열 비교를 계산한다.
 *
 * 세 탭이 같은 계산을 써야 같은 칸을 말한다. 칸 경계는 0.1 눈금이고 폭은 0.1 또는 0.2다. 따라가기 숫자는 PDR-0009의 검정을
 * 고른 지역에 그대로 다시 한 것이다.
 */
export interface StatPoint {
  /** 개찰 시각(epoch 밀리초)이다. 같은 시각 공고끼리는 서로를 보지 않는다. */
  readonly t: number;
  /** 하한선, 기초금액 대비 %다. */
  readonly floor: number;
  /** KST 달(`2026-09`)이다. */
  readonly month: string;
}

export type BandWidth = 0.1 | 0.2;

export interface MonthBand {
  readonly month: string;
  readonly count: number;
  readonly lo: number;
  readonly hi: number;
  readonly inside: number;
}

/** 공고가 이보다 적은 달은 칸을 고르지 않는다. 방학 달 몇 건으로 고른 칸은 칸이라 부르기 어렵다. */
export const MIN_MONTH_COUNT = 20;
const LOW = 87.0;
const SLOTS = 64;

function slotOf(value: number): number {
  return Math.floor((value - LOW) / 0.1 + 1e-9);
}

export function inBand(value: number, lo: number, width: number): boolean {
  return value >= lo - 1e-9 && value < lo + width - 1e-9;
}

function slotCounts(values: readonly number[]): number[] {
  const counts = Array.from({ length: SLOTS }, () => 0);
  for (const value of values) {
    const slot = slotOf(value);
    if (slot >= 0 && slot < SLOTS) counts[slot] = counts[slot]! + 1;
  }
  return counts;
}

/**
 * 0.1 칸별 건수에서 가장 많이 든 칸을 고른다. 같은 수면 가운데값이 든 칸에 가까운 쪽이다 — 첫 칸을 고르면 같은 몰림이 늘
 * 아래쪽으로 기운다. 가운데값은 0.1 칸 단위로 본다. 앞서 본 공고가 쌓일 때마다 다시 고르는 따라가기 검정이 칸별 건수만 들고
 * 다니게 하기 위해서다.
 */
function pickBand(counts: readonly number[], width: number): { lo: number; inside: number } {
  const total = counts.reduce((sum, count) => sum + count, 0);
  let cumulative = 0;
  let medianSlot = 30;
  for (let slot = 0; slot < SLOTS; slot += 1) {
    cumulative += counts[slot]!;
    if (2 * cumulative >= total && total > 0) {
      medianSlot = slot;
      break;
    }
  }
  const median = LOW + (medianSlot + 0.5) * 0.1;
  const span = Math.round(width * 10);
  let best = { lo: 90, inside: -1, gap: Infinity };
  for (let slot = 0; slot + span <= SLOTS; slot += 1) {
    let inside = 0;
    for (let k = 0; k < span; k += 1) inside += counts[slot + k]!;
    const lo = Math.round((LOW + slot * 0.1) * 10) / 10;
    const gap = Math.abs(lo + width / 2 - median);
    if (inside > best.inside || (inside === best.inside && gap < best.gap)) best = { lo, inside, gap };
  }
  return { lo: best.lo, inside: Math.max(0, best.inside) };
}

export function hottestBand(values: readonly number[], width: number): { lo: number; inside: number } {
  return pickBand(slotCounts(values), width);
}

function groupByMonth<T extends { readonly month: string }>(items: readonly T[]): Map<string, T[]> {
  const byMonth = new Map<string, T[]>();
  for (const item of items) {
    const list = byMonth.get(item.month);
    if (list === undefined) byMonth.set(item.month, [item]);
    else list.push(item);
  }
  return byMonth;
}

export function monthBands(points: readonly StatPoint[], width: number): MonthBand[] {
  return [...groupByMonth(points).entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([month, monthPoints]) => {
      const band = hottestBand(
        monthPoints.map((point) => point.floor),
        width
      );
      return { month, count: monthPoints.length, lo: band.lo, hi: Math.round((band.lo + width) * 10) / 10, inside: band.inside };
    });
}

/**
 * 같은 달에 먼저 개찰된 공고가 10건 넘으면 그 공고들이 가장 많이 몰린 칸을 고르고 다음 공고 하한선이 거기 들어가는지 센다.
 * 같은 시각 개찰끼리는 서로를 보지 않는다.
 */
export function sameMonthFollowRate(points: readonly StatPoint[], width: number): { hits: number; tries: number } {
  let hits = 0;
  let tries = 0;
  for (const monthPoints of groupByMonth(points).values()) {
    const ordered = monthPoints.toSorted((left, right) => left.t - right.t);
    const counts = Array.from({ length: SLOTS }, () => 0);
    let seen = 0;
    let index = 0;
    while (index < ordered.length) {
      let end = index;
      while (end < ordered.length && ordered[end]!.t === ordered[index]!.t) end += 1;
      if (seen >= 10) {
        const band = pickBand(counts, width);
        for (let k = index; k < end; k += 1) {
          tries += 1;
          if (inBand(ordered[k]!.floor, band.lo, width)) hits += 1;
        }
      }
      for (let k = index; k < end; k += 1) {
        const slot = slotOf(ordered[k]!.floor);
        if (slot >= 0 && slot < SLOTS) counts[slot] = counts[slot]! + 1;
        seen += 1;
      }
      index = end;
    }
  }
  return { hits, tries };
}

/**
 * 지난달 가장 많이 나온 칸에 이번 달 내내 넣었다면 하한선이 그 칸에 든 비율이다. 공고가 적은 달은 건너뛴다. `order`를 주면
 * 달의 칸을 그 순서로 섞어 "아무 달의 칸"을 갖다 댄 경우를 센다.
 */
export function previousMonthFollowRate(
  points: readonly StatPoint[],
  width: number,
  order?: readonly number[]
): { hits: number; tries: number; months: number } {
  const bands = monthBands(points, width).filter((band) => band.count >= MIN_MONTH_COUNT);
  const byMonth = groupByMonth(points);
  const sequence = order === undefined ? bands : order.map((index) => bands[index]!);
  let hits = 0;
  let tries = 0;
  for (let index = 1; index < bands.length; index += 1) {
    const lo = sequence[index - 1]!.lo;
    for (const point of byMonth.get(bands[index]!.month) ?? []) {
      tries += 1;
      if (inBand(point.floor, lo, width)) hits += 1;
    }
  }
  return { hits, tries, months: bands.length };
}

/** 값을 아무렇게나 섞는다(Fisher–Yates). 같은 난수 씨앗이면 같은 순서다. */
export function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy;
}

/** 하한선 값을 섞은 뒤 같은 시각·같은 달 자리에 다시 놓는다. 몰림이 우연인지 견줄 기준이다. */
export function shuffledFloors(points: readonly StatPoint[], random: () => number): StatPoint[] {
  const values = shuffled(
    points.map((point) => point.floor),
    random
  );
  return points.map((point, index) => ({ ...point, floor: values[index]! }));
}
