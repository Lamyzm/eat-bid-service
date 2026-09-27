/** @module 책임: 전체 개찰 이력 응답의 회차 줄을 표와 좁은 화면 목록이 그대로 그리는 문자열로 옮긴다. */
import { Temporal } from '@eatbid/domain';
import type { AnalysisHistoryRow } from '@eatbid/contracts/api/v1/analysis';
import {
  rateMilli,
  rateText
} from '@/app/(workspace)/auctions/[auctionId]/analysis/_lib/rate-milli';

export interface HistoryRowView {
  readonly attemptId: string;
  readonly revisionId: string;
  readonly dateText: string;
  readonly organizationText: string;
  readonly itemText: string;
  readonly rateText: string;
  /** 2순위 − 낙찰(%p). 원천 `RNK=2` 행이라 음수일 수 있고 부호를 그대로 적는다. */
  readonly secondGapText: string;
  readonly winnerText: string;
  /** 명단을 관측하지 못했으면 그 사실을 말한다. 0곳과 다르다. */
  readonly listText: string;
  readonly baseAmountText: string;
}

function kstDate(instant: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO('Asia/Seoul').toPlainDate().toString();
}

function moneyText(amount: string): string {
  const [whole] = amount.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}

/**
 * 날짜는 조건의 기준(개찰·공고)을 따른다. 표의 날짜와 그림의 가로축이 다른 시각을 쓰면 같은 회차가 두
 * 자리에 있는 것처럼 읽힌다.
 */
export function presentHistoryRow(
  row: AnalysisHistoryRow,
  dateBasis: 'opened' | 'announced'
): HistoryRowView {
  const date = dateBasis === 'opened' ? row.openedAt : row.announcedAt;
  const gap =
    row.secondRate === null
      ? null
      : rateMilli(row.secondRate.value) - rateMilli(row.assessmentRate.value);
  const list =
    row.listCount === null
      ? '명단 미관측'
      : `${row.listCount}곳${row.belowDayFloorCount === null ? '' : ` · 하한 미만 ${row.belowDayFloorCount}`}`;
  return {
    attemptId: row.attemptId,
    revisionId: row.revisionId,
    dateText: date === null ? '날짜 미확인' : kstDate(date),
    organizationText: row.organizationName ?? '기관명 미확인',
    itemText: row.items === null ? '품목 미확인' : row.items.join('·'),
    rateText: row.assessmentRate.value,
    secondGapText: gap === null ? '—' : `${gap < 0 ? '−' : '+'}${rateText(Math.abs(gap))}`,
    winnerText: row.winner === null ? '낙찰 업체 미확인' : (row.winner.name ?? '업체명 미확인'),
    listText: list,
    baseAmountText: moneyText(row.baseAmount.amount)
  };
}
