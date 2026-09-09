/** @module 책임: 회차 표의 마지막 가정 계산 열을 손잡이 값에 맞춰 그리고, 값이 없는 동안은 열 자체를 없앤다. */
'use client';

import { toMilli } from '../_model/bid-rate';
import { judgeRow, type RowVerdict, type RowVerdictInput } from '../_model/rehearsal';
import { ROW_VERDICT_PHRASE } from '../_model/verdict-vocabulary';
import { useBidRate } from './bid-rate-context';

// 마지막 열은 원본 판정이 아니라 내 값과 낙찰값·그날 하한의 비교이므로 문구는 파생 서술 어휘에서만 가져온다(PDR-0002).
const VERDICT_TEXT: Record<RowVerdict, string> = {
  won: ROW_VERDICT_PHRASE.won.text,
  missed: ROW_VERDICT_PHRASE.missed.text,
  invalid: ROW_VERDICT_PHRASE.invalid.text,
  unknown: ROW_VERDICT_PHRASE.unknown.text
};

const VERDICT_CLASS: Record<RowVerdict, string> = {
  won: 'text-primary font-semibold',
  missed: 'text-muted-foreground',
  invalid: 'text-destructive',
  unknown: 'text-muted-foreground'
};

const HEAD_CLASS =
  'sticky right-0 top-0 z-30 border-b border-border bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] px-2 py-2 text-right text-[13px] font-semibold whitespace-nowrap tabular-nums text-primary xl:px-3 [[data-scroll-right]_&]:shadow-[-14px_0_14px_-10px_rgb(0_0_0/0.3)]';
const CELL_CLASS =
  'sticky right-0 z-10 border-b border-border/60 bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] px-2 py-2 text-right text-[15px] whitespace-nowrap tabular-nums group-last/row:border-b-0 xl:px-3 [[data-scroll-right]_&]:shadow-[-14px_0_14px_-10px_rgb(0_0_0/0.3)]';

/**
 * 손잡이 값이 없으면 이 열은 아예 없다. 옛 표 라이브러리의 `columnVisibility` boolean 하나가 하던 일이며,
 * 손잡이는 서버 왕복 없이 ±0.001씩 움직이는 브라우저 상태라 머리글과 셀만 client leaf로 남는다(EAT-84, EAT-139).
 */
export function HistoryVerdictHead() {
  const { rate } = useBidRate();
  if (rate === null) return null;
  return (
    <th scope='col' className={HEAD_CLASS}>
      {rate} 썼다면
    </th>
  );
}

/** 판정에 필요한 것은 그날 하한과 낙찰 투찰률 둘뿐이다. 표 행 전체를 브라우저로 넘기지 않는다(EAT-139). */
export function HistoryVerdictCell({ dayFloorMilli, awardedBidRateMilli }: RowVerdictInput) {
  const { rate } = useBidRate();
  if (rate === null) return null;
  const verdict = judgeRow({ dayFloorMilli, awardedBidRateMilli }, toMilli(rate));
  return (
    <td className={CELL_CLASS}>
      <span className={VERDICT_CLASS[verdict]}>{VERDICT_TEXT[verdict]}</span>
    </td>
  );
}
