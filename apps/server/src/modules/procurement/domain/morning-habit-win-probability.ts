/**
 * @module 책임: 경쟁 성분(업체마다 자리 분포)과 예정가격 추첨 분포로, 후보 배수 한 장과 두 장의 낙찰 확률을 정확히 적분하고 가장
 * 큰 자리를 고르는 계산을 소유한다.
 *
 * 매달 맞춤은 지난 공고들의 실제 배치를 세지만, 이 계산은 오늘 공고 하나의 "있을 법한" 배치를 확률로 적분한다. 예정가격 비율
 * y가 뽑히면 내 자리 x(≥ y)가 이기는 것은 어느 경쟁자도 [y, x)에 없을 때다. 경쟁자는 서로 독립이라고 본다(분석 엔진 p2_exact).
 *
 * 단골 몫은 마감일마다 한 번(`habitWinBasis`), 참여 수에 달린 비단골 몫은 공고마다(`ticketWinTable`) 더한다. 칸마다 더하는
 * 순서(단골 순 → 비단골 정수 몫 → 소수 몫)를 분석 엔진과 같게 둬서 나눠 계산해도 같은 값이 나온다.
 */
import type { HabitCompetitors } from "./morning-habit-field";
import { lowerBound } from "./morning-habit-history";
import type { MorningHabitMethod } from "./morning-habit-pick-table";
import { cumulativeAt, gridOf, multipleText, type PlannedRatioDistribution } from "./market-position-pick";

interface PlannedCells {
  /** 격자점 전체다. 칸 `j`는 `[points[j], points[j + 1])`이다. */
  readonly points: Float64Array;
  readonly middles: Float64Array;
  readonly masses: Float64Array;
}

const cellCache = new WeakMap<PlannedRatioDistribution, Map<string, PlannedCells>>();

/**
 * 예정가격 비율 격자다. numpy `arange`가 둘째 값과 첫 값의 차를 간격으로 삼아 채우는 방식을 그대로 따른다 — 0.2를 그대로 곱하면
 * 끝자리가 달라 분석과 다른 칸 경계를 쓴다.
 */
function plannedCells(method: MorningHabitMethod, distribution: PlannedRatioDistribution): PlannedCells {
  const { fromTenThousandths: from, belowTenThousandths: below, stepTenThousandths: step } = method.plannedGrid;
  const key = `${from}:${below}:${step}`;
  const cached = cellCache.get(distribution)?.get(key);
  if (cached !== undefined) return cached;
  const count = Math.ceil((below - from) / step);
  const delta = (from + step) - from;
  const points = Float64Array.from({ length: count }, (_, index) => (from + index * delta) / 10000);
  const cumulative = points.map((point) => cumulativeAt(distribution, point));
  const halfStep = (points[1]! - points[0]!) / 2;
  const cells: PlannedCells = {
    points,
    middles: points.subarray(0, count - 1).map((point) => point + halfStep),
    masses: Float64Array.from({ length: count - 1 }, (_, index) => cumulative[index + 1]! - cumulative[index]!),
  };
  const byKey = cellCache.get(distribution) ?? new Map<string, PlannedCells>();
  byKey.set(key, cells);
  cellCache.set(distribution, byKey);
  return cells;
}

/** 자리 `values`(확률 `weights`)가 `points`(오름차순) 각각보다 낮을 확률이다. */
function belowEach(values: readonly number[], weights: readonly number[], points: ArrayLike<number>): Float64Array {
  const order = values.map((_, index) => index).sort((left, right) => values[left]! - values[right]!);
  const result = new Float64Array(points.length);
  let cursor = 0;
  let mass = 0;
  for (let index = 0; index < points.length; index += 1) {
    while (cursor < order.length && values[order[cursor]!]! < points[index]!) {
      mass += weights[order[cursor]!]!;
      cursor += 1;
    }
    result[index] = mass;
  }
  return result;
}

/** 후보 격자와 예정가격 칸, 후보마다 이길 수 있는 칸 수(`reach`)다. */
interface Grid {
  readonly candidates: readonly number[];
  readonly points: readonly number[];
  readonly cells: PlannedCells;
  readonly reach: readonly number[];
}

/**
 * 성분 하나가 "칸과 후보 사이에 들어오지 않을" 로그 확률을 칸마다 더한다. 칸 j에서 값은 그 칸 가운데보다 낮을 확률에만 달려
 * 있어, 그 확률이 같은 칸 묶음마다 로그를 한 번만 구한다(같은 값을 더하므로 칸마다 구한 것과 같다). 0이면 더하지 않는다.
 */
function addComponent(target: Float64Array, grid: Grid, values: readonly number[], weights: readonly number[], multiplicity: number): void {
  const width = grid.cells.middles.length;
  const belowCandidate = belowEach(values, weights, grid.points);
  const belowMiddle = belowEach(values, weights, grid.cells.middles);
  for (let g = 0; g < grid.candidates.length; g += 1) {
    const row = g * width;
    const limit = grid.reach[g]!;
    let start = 0;
    while (start < limit) {
      const level = belowMiddle[start]!;
      let end = start + 1;
      while (end < limit && belowMiddle[end] === level) end += 1;
      const inside = Math.min(1, Math.max(0, belowCandidate[g]! - level));
      const term = multiplicity * Math.log(Math.min(1, Math.max(1e-300, 1 - inside)));
      if (term !== 0) for (let j = start; j < end; j += 1) target[row + j] = target[row + j]! + term;
      start = end;
    }
  }
}

/** 마감일 하나의 단골 몫까지 더한 로그 표와, 공고마다 더할 비단골 묶음이다. */
export interface HabitWinBasis {
  readonly grid: Grid;
  readonly regularLog: Float64Array;
  readonly competitors: HabitCompetitors;
}

export function habitWinBasis(
  competitors: HabitCompetitors,
  method: MorningHabitMethod,
  distribution: PlannedRatioDistribution,
): HabitWinBasis {
  const candidates = gridOf(method.candidates);
  const cells = plannedCells(method, distribution);
  const points = candidates.map((candidate) => candidate / 10000);
  // 후보마다 그보다 낮은 칸 수다. 그 칸들에서만 그 후보가 이길 수 있다.
  const grid: Grid = { candidates, points, cells, reach: points.map((point) => lowerBound(cells.points, point - 1e-12)) };
  const regularLog = new Float64Array(candidates.length * cells.middles.length);
  for (const component of competitors.regulars) {
    addComponent(regularLog, grid, component.values, component.weights, component.multiplicity);
  }
  return { grid, regularLog, competitors };
}

export interface TicketWinTable {
  readonly candidates: readonly number[];
  /** 한 장 낙찰 확률이다. */
  readonly single: Float64Array;
  /** 두 장(낮은 쪽 `i` < 높은 쪽 `k`) 낙찰 확률이며 `i * size + k`에 둔다. */
  readonly pair: Float64Array;
}

/**
 * 참여 수에서 단골 기대 참여를 뺀 만큼 비단골이 나온다고 보고 표를 마친다. 정수 몫은 같은 묶음에서 독립으로 뽑힌 그만큼의
 * 업체이고, 남는 소수 몫은 그 확률로 나오는 한 곳이다.
 */
export function ticketWinTable(basis: HabitWinBasis, competitorCount: number): TicketWinTable {
  const { grid, competitors } = basis;
  const size = grid.candidates.length;
  const width = grid.cells.middles.length;
  const logClear = Float64Array.from(basis.regularLog);
  const pool = competitors.nonRegularPool;
  const remaining = Math.max(0, competitorCount - competitors.expectedRegulars);
  if (pool.length > 0 && remaining > 0) {
    const whole = Math.trunc(remaining);
    const uniform = 1 / pool.length;
    if (whole > 0) addComponent(logClear, grid, pool, pool.map(() => uniform), whole);
    const fraction = remaining - whole;
    if (fraction > 1e-9) addComponent(logClear, grid, pool, pool.map(() => uniform * fraction), 1);
  }
  // 누적: 후보 g로 이기는 확률을 예정가격 칸 j까지 더한 값이다.
  const winUpTo = new Float64Array(size * width);
  for (let g = 0; g < size; g += 1) {
    let running = 0;
    for (let j = 0; j < grid.reach[g]!; j += 1) {
      running += Math.exp(logClear[g * width + j]!) * grid.cells.masses[j]!;
      winUpTo[g * width + j] = running;
    }
  }
  const single = Float64Array.from(grid.candidates, (_, g) => winUpTo[g * width + grid.reach[g]! - 1]!);
  const pair = new Float64Array(size * size);
  for (let low = 0; low < size; low += 1) {
    for (let high = low + 1; high < size; high += 1) {
      // 낮은 쪽이 이기는 경우 높은 쪽은 상관없다. 둘 다 이기는 몫(예정가격이 낮은 쪽 아래이고 높은 쪽까지 비어 있음)을 뺀다.
      pair[low * size + high] = single[low]! + single[high]! - winUpTo[high * width + grid.reach[low]! - 1]!;
    }
  }
  return { candidates: grid.candidates, single, pair };
}

/** 확률이 가장 큰 자리다. 같으면 낮은 배수부터 — 분석 스크립트(numpy argmax)와 같은 순서다. */
export function bestTickets(
  table: TicketWinTable,
  tickets: 1 | 2,
): { readonly multiples: readonly string[]; readonly winProbability: number } {
  const size = table.candidates.length;
  if (tickets === 1) {
    let best = 0;
    for (let g = 1; g < size; g += 1) if (table.single[g]! > table.single[best]!) best = g;
    return { multiples: [multipleText(table.candidates[best]!)], winProbability: table.single[best]! };
  }
  let best = 1;
  for (let cell = 2; cell < size * size; cell += 1) if (table.pair[cell]! > table.pair[best]!) best = cell;
  const low = Math.floor(best / size);
  const high = best % size;
  return { multiples: [multipleText(table.candidates[low]!), multipleText(table.candidates[high]!)], winProbability: table.pair[best]! };
}

