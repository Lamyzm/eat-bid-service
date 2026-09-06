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

type ObservedRateRow = HistoryRow & { readonly winRateMilli: bigint; readonly winRateText: string };

function hasWinRate(row: HistoryRow): row is ObservedRateRow {
  return row.winRateMilli !== null && row.winRateText !== null;
}

/** 한 회차에 이 값을 냈다면 어떻게 됐을지. 표의 마지막 열과 레일 패널이 같은 규칙을 쓰도록 공유한다. */
export type RowVerdict = 'won' | 'missed' | 'invalid' | 'unknown';

// eaT는 그날 하한 이상인 투찰 중 가장 낮은 투찰률이 낙찰한다. 손잡이 값이 실제 낙찰률 이하이면서
// 하한을 밑돌지 않으면(같은 값은 추첨이므로 낙찰로 센다) 그 회차를 낙찰됐을 회차로 센다. 하한을
// 밑돈 회차는 애초에 무효라 낙찰 여부를 따지지 않으므로 무효 판정이 먼저다.
//
// 세 값이 모두 투찰률 축(분모 기초금액)이어야 한 비교식에 들어갈 수 있다(AGENTS 15). 표에 함께 보이는
// 낙찰률 `winRateMilli`는 분모가 예정가격인 사정률이라 이 판정에 넣지 않는다. 남산초 실관측 92회차에서
// 두 축은 전부 0.01%p 이상, 최대 2.19%p 벌어지고 90.000 손잡이에서는 92회차 중 42회차가 갈린다.
export function judgeRow(row: HistoryRow, rateMilli: bigint): RowVerdict {
  // 그날 하한만 알면 무효는 확정이다. 낙찰률이 없는 회차라도 하한 미달을 'unknown'으로 감추면
  // "무효였을 회차"가 실제보다 적게 보인다.
  if (row.dayFloorMilli !== null && rateMilli < row.dayFloorMilli) return 'invalid';
  // 예정가격이 아직 관측되지 않아 축을 옮길 수 없는 회차다. 사정률로 대신 판정하면 그 회차만
  // 다른 축의 답을 내므로 판정 불가로 남긴다(AGENTS 3·8).
  if (row.awardedBidRateMilli === null) return 'unknown';
  return rateMilli <= row.awardedBidRateMilli ? 'won' : 'missed';
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  // 짝수 개면 위쪽 중간값을 쓴다(디자인 생성기의 `sizes[len // 2]`와 같은 규칙).
  return sorted[Math.floor(sorted.length / 2)];
}

function buildByYear(
  rows: readonly HistoryRow[],
  wonFlags: readonly boolean[]
): Rehearsal['byYear'] {
  const buckets = new Map<string, { won: number; total: number }>();
  rows.forEach((row, index) => {
    const year = row.openedYear;
    const bucket = buckets.get(year) ?? { won: 0, total: 0 };
    bucket.total += 1;
    if (wonFlags[index]) bucket.won += 1;
    buckets.set(year, bucket);
  });
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, bucket]) => ({ year, ...bucket }));
}

// 관측된 낙찰률의 범위는 사정률 축의 사실이다. 호가창 눈금과 같은 축이라야 두 화면이 같은 값을
// 말한다(PDR-0004). 판정과 축이 다르므로 여기서는 winRate를 그대로 쓴다.
function buildRateSpan(rows: readonly ObservedRateRow[]): Rehearsal['rateSpan'] {
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
  // 분모는 판정할 수 있었던 회차다. 낙찰률이 없어도 그날 하한을 알면 무효는 확정이므로
  // judgeRow가 'unknown'을 돌려준 회차만 뺀다.
  const judged = chronological
    .map((row) => ({ row, verdict: judgeRow(row, rateMilli) }))
    .filter((entry) => entry.verdict !== 'unknown');

  const wonFlags = judged.map((entry) => entry.verdict === 'won');
  const won = wonFlags.filter(Boolean).length;
  const invalid = judged.filter((entry) => entry.verdict === 'invalid').length;

  const listCounts = rows
    .map((row) => row.listCount)
    .filter((value): value is number => value !== null);

  return {
    total: judged.length,
    won,
    wonFlags,
    invalid,
    byYear: buildByYear(judged.map((entry) => entry.row), wonFlags),
    usualListCount: listCounts.length === 0 ? null : medianOf(listCounts),
    // 낙찰률 분포는 실제로 관측된 낙찰률만의 사실이라 무효 판정과 분모를 공유하지 않는다.
    rateSpan: buildRateSpan(chronological.filter(hasWinRate))
  };
}
