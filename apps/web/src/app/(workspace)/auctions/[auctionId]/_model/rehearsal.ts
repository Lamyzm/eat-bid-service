/** @module 책임: 손잡이가 가리키는 투찰률을 선택 품목의 회차 이력에 적용해 "이 값이면" 낙찰 횟수를 순수 계산한다. */
import type { BidRate } from './bid-rate';
import { toMilli } from './bid-rate';
import type { HistoryRow } from './attempt-history';

export type Rehearsal = {
  readonly total: number;
  readonly won: number;
  readonly wonFlags: readonly boolean[];
  readonly invalid: number;
  readonly byYear: readonly { readonly year: string; readonly won: number; readonly total: number }[];
  readonly usualListCount: number | null;
  readonly rateSpan: { readonly min: string; readonly max: string; readonly median: string } | null;
};

type DeterminedRow = HistoryRow & { readonly winRateMilli: bigint; readonly winRateText: string };

function hasWinRate(row: HistoryRow): row is DeterminedRow {
  return row.winRateMilli !== null && row.winRateText !== null;
}

// eaT는 그날 하한 이상인 투찰 중 가장 낮은 투찰률이 낙찰한다. 손잡이 값이 실제 낙찰률 이하이면서
// 하한을 밑돌지 않으면(같은 값은 추첨이므로 낙찰로 센다) 그 회차를 낙찰됐을 회차로 센다.
function wouldWin(rateMilli: bigint, row: DeterminedRow): boolean {
  const belowFloor = row.dayFloorMilli !== null && rateMilli < row.dayFloorMilli;
  return rateMilli <= row.winRateMilli && !belowFloor;
}

// 개찰 시각(없으면 공고 시각)의 KST 연도는 attempt-history.ts가 이미 만든 `YY-MM-DD[ 공고]` 텍스트
// 앞 두 자리로 복원한다. eaT 관측 범위가 21세기이므로 세기를 20으로 고정해도 안전하다.
function yearOf(row: HistoryRow): string {
  return `20${row.openedText.slice(0, 2)}`;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  // 짝수 개면 위쪽 중간값을 쓴다(디자인 생성기의 `sizes[len // 2]`와 같은 규칙).
  return sorted[Math.floor(sorted.length / 2)];
}

function buildByYear(
  rows: readonly DeterminedRow[],
  wonFlags: readonly boolean[]
): Rehearsal['byYear'] {
  const buckets = new Map<string, { won: number; total: number }>();
  rows.forEach((row, index) => {
    const year = yearOf(row);
    const bucket = buckets.get(year) ?? { won: 0, total: 0 };
    bucket.total += 1;
    if (wonFlags[index]) bucket.won += 1;
    buckets.set(year, bucket);
  });
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, bucket]) => ({ year, ...bucket }));
}

function buildRateSpan(rows: readonly DeterminedRow[]): Rehearsal['rateSpan'] {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (a.winRateMilli < b.winRateMilli ? -1 : a.winRateMilli > b.winRateMilli ? 1 : 0));
  return {
    min: sorted[0].winRateText,
    max: sorted[sorted.length - 1].winRateText,
    median: sorted[Math.floor(sorted.length / 2)].winRateText
  };
}

export function rehearse(rows: readonly HistoryRow[], rate: BidRate): Rehearsal {
  const rateMilli = toMilli(rate);
  // 응답(그리고 presentHistory의 rows)은 최근 → 오래된 순이라 시계열 판정은 오래된 → 최근 순으로 뒤집는다.
  const chronological = [...rows].reverse();
  // winRate가 없는 회차는 낙찰 여부를 판정할 수 없으므로 분모(total)에서도 뺀다.
  const determined = chronological.filter(hasWinRate);

  const wonFlags = determined.map((row) => wouldWin(rateMilli, row));
  const won = wonFlags.filter(Boolean).length;
  const invalid = determined.filter(
    (row) => row.dayFloorMilli !== null && rateMilli < row.dayFloorMilli
  ).length;

  const listCounts = rows
    .map((row) => row.listCount)
    .filter((value): value is number => value !== null);

  return {
    total: determined.length,
    won,
    wonFlags,
    invalid,
    byYear: buildByYear(determined, wonFlags),
    usualListCount: listCounts.length === 0 ? null : medianOf(listCounts),
    rateSpan: buildRateSpan(determined)
  };
}
