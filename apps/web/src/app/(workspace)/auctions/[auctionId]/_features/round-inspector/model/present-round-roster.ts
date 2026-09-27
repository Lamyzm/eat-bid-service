/**
 * @module 책임: 한 회차의 명단 응답을 사이드바가 그대로 그리는 요약·사정률 띠·행 목록으로 옮긴다.
 */
import { Temporal } from '@eatbid/domain';
import type { AuctionRosterV1Response } from '@eatbid/contracts/api/v1/auctions';
import {
  rateMilli,
  rateText
} from '@/app/(workspace)/auctions/[auctionId]/_lib/rate-milli';

export interface RosterRowView {
  readonly key: string;
  readonly rankText: string;
  readonly supplierName: string;
  readonly rateText: string;
  readonly amountText: string;
  readonly isWinner: boolean;
  /** 하한율을 모르면 판단하지 않는다. `false`가 아니라 `null`이다. */
  readonly belowFloor: boolean | null;
}

export interface RosterStripDot {
  readonly key: string;
  readonly x: number;
  readonly isWinner: boolean;
  readonly belowFloor: boolean | null;
}

export interface RosterStripView {
  readonly from: number;
  readonly to: number;
  readonly floor: number | null;
  readonly dots: readonly RosterStripDot[];
  /** 띠 밖으로 나간 행 수다. 가장자리에 붙여 그리되 몇 개인지는 글로 남긴다. */
  readonly outsideBelow: number;
  readonly outsideAbove: number;
}

export type RoundRosterView =
  | { readonly kind: 'not-observed'; readonly observedAtText: string }
  | {
      readonly kind: 'observed';
      readonly winnerName: string | null;
      readonly winnerRateText: string | null;
      /** 2순위 사정률 − 낙찰 사정률(%p). 2순위는 원천 `RNK=2` 행이라 음수일 수 있고 그대로 적는다. */
      readonly secondGapText: string | null;
      readonly rowCount: number;
      /** 원천이 말한 명단 수다. 받은 행 수와 다르면 둘 다 보여 준다. */
      readonly sourceRosterSize: number | null;
      readonly belowFloorCount: number | null;
      readonly observedAtText: string;
      readonly strip: RosterStripView;
      readonly rows: readonly RosterRowView[];
    };

/** 사정률 띠의 최소 폭이다(1%p). 명단이 한 자리에 몰려도 하한과의 거리를 읽을 여유를 준다. */
const MIN_STRIP_WIDTH = 1_000;

function moneyText(amount: string): string {
  const [whole, fraction] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (
    (fraction === undefined || /^0+$/.test(fraction) ? grouped : `${grouped}.${fraction}`) + '원'
  );
}

function kstText(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul');
  return `${zoned.toPlainDate().toString()} ${String(zoned.hour).padStart(2, '0')}:${String(zoned.minute).padStart(2, '0')}`;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))] ?? 0;
}

/**
 * 띠의 범위는 명단 가운데 덩어리에 맞추되 하한과 낙찰 자리는 반드시 담는다. 하한 아래로 수백 곳이 몰린
 * 회차가 흔하다(2026-08 실측 256곳 중 218곳) — 최솟값까지 담으면 하한 위 경쟁이 한 점으로 뭉친다.
 */
function stripRange(
  rates: readonly number[],
  floor: number | null,
  winner: number | null
): [number, number] {
  const sorted = rates.toSorted((a, b) => a - b);
  let from = quantile(sorted, 0.05);
  let to = quantile(sorted, 0.95);
  for (const anchor of [floor, winner]) {
    if (anchor === null) continue;
    from = Math.min(from, anchor);
    to = Math.max(to, anchor);
  }
  if (to - from < MIN_STRIP_WIDTH) {
    const center = (from + to) / 2;
    from = Math.round(center - MIN_STRIP_WIDTH / 2);
    to = Math.round(center + MIN_STRIP_WIDTH / 2);
  }
  const pad = Math.round((to - from) * 0.04);
  return [from - pad, to + pad];
}

export function presentRoundRoster(
  roster: AuctionRosterV1Response,
  floorRate: string | null
): RoundRosterView {
  const observedAtText = kstText(roster.meta.observedAt);
  if (roster.state === 'not-observed') return { kind: 'not-observed', observedAtText };
  const floor = floorRate === null ? null : rateMilli(floorRate);
  const winnerOrdinal = roster.award?.rosterOrdinal ?? null;
  const rows = roster.rows.toSorted(
    (a, b) =>
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
      a.rosterOrdinal - b.rosterOrdinal
  );
  const rates = rows.map((row) => rateMilli(row.bidRate.value));
  const winnerRate = roster.award === null ? null : rateMilli(roster.award.bidRate.value);
  const [from, to] = stripRange(rates, floor, winnerRate);
  const below = (rate: number) => (floor === null ? null : rate < floor);
  const winnerRow = rows.find((row) => row.rosterOrdinal === winnerOrdinal) ?? null;
  const secondGap =
    roster.award?.secondRate == null || winnerRate === null
      ? null
      : rateMilli(roster.award.secondRate.value) - winnerRate;
  return {
    kind: 'observed',
    winnerName: winnerRow?.supplier.name ?? null,
    winnerRateText: roster.award?.bidRate.value ?? null,
    secondGapText:
      secondGap === null ? null : `${secondGap < 0 ? '−' : '+'}${rateText(Math.abs(secondGap))}%p`,
    rowCount: roster.meta.rowCount,
    sourceRosterSize: roster.meta.sourceRosterSize,
    belowFloorCount: floor === null ? null : rates.filter((rate) => rate < floor).length,
    observedAtText,
    strip: {
      from,
      to,
      floor,
      dots: rows.map((row, index) => ({
        key: row.submissionId,
        x: Math.min(Math.max(rates[index]!, from), to),
        isWinner: row.rosterOrdinal === winnerOrdinal,
        belowFloor: below(rates[index]!)
      })),
      outsideBelow: rates.filter((rate) => rate < from).length,
      outsideAbove: rates.filter((rate) => rate > to).length
    },
    rows: rows.map((row, index) => ({
      key: row.submissionId,
      rankText: row.rank === null ? '순위 미확인' : `${row.rank}위`,
      supplierName: row.supplier.name ?? '업체명 미확인',
      rateText: row.bidRate.value,
      // BID_CALC_AMT에는 하한 미만 행의 자리표시값이 섞여 있다(ADR 0041). 제출 금액만 금액으로 적는다.
      amountText:
        row.submittedAmount === null ? '금액 미확인' : moneyText(row.submittedAmount.amount),
      isWinner: row.rosterOrdinal === winnerOrdinal,
      belowFloor: below(rates[index]!)
    }))
  };
}
