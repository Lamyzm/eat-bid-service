/**
 * @module 책임: 추천 금액 한 자리를 사정률(크게, 복사 표시)과 기초금액 대비 %·확인용 금액(작게, 눌러 복사)으로 그린다. 오늘 투찰과
 * 공고 상세가 같은 모양을 쓴다.
 */
import { CopyValue } from '@/shared/ui/copy-value';

import type { BidFigure } from './bid-figure';

const BIG = 'inline-flex items-baseline gap-1.5 rounded text-[16px] font-extrabold tracking-[-0.02em] tabular-nums hover:underline';
const SMALL = 'rounded tabular-nums underline decoration-dotted underline-offset-2 hover:text-foreground';

/**
 * eaT에 넣는 숫자가 사정률이라 그것을 크게 둔다(사용자 확인, 2026-10-11). 분모가 다른 소수끼리 헷갈리지 않게 숫자마다 이름을
 * 붙인다(ADR 0062). 사정률을 계산하지 못한 자리(하한율 미확인)는 금액을 크게 둔다 — 소수를 지어내지 않는다.
 */
export function BidFigureLine({
  label,
  figure,
  lead = false,
  showLabel = true
}: {
  readonly label: string;
  readonly figure: BidFigure;
  /** 근거가 가장 강한 칸이면 큰 숫자를 테두리와 같은 색으로 쓴다. */
  readonly lead?: boolean;
  /** 이름을 왼쪽 칸에 따로 적는 목록은 숫자 옆 이름을 감춘다. 읽기 이름에는 그대로 남는다. */
  readonly showLabel?: boolean;
}) {
  const big = `${BIG} ${lead ? 'text-primary' : ''}`;
  return (
    <span data-slot='bid-figure' className='grid justify-items-end gap-1'>
      <span className='flex items-baseline justify-end gap-1.5 whitespace-nowrap'>
        {showLabel ? <span className='text-[12px] font-semibold text-muted-foreground/70'>{label}</span> : null}
        {figure.assessmentRate === null ? (
          <CopyValue value={figure.amountCopy} label={`${label} 금액 ${figure.amount}`} chip className={big}>
            <span>{figure.amount}</span>
          </CopyValue>
        ) : (
          <>
            <span className='text-[11.5px] font-semibold text-muted-foreground'>사정률</span>
            <CopyValue value={figure.assessmentRate} label={`${label} 사정률 ${figure.assessmentRate}`} chip className={big}>
              <span>{figure.assessmentRate}</span>
            </CopyValue>
          </>
        )}
      </span>
      <span className='flex items-baseline justify-end gap-1 whitespace-nowrap text-[11.5px] text-muted-foreground'>
        <span>기초대비</span>
        <CopyValue value={figure.baseRelative} label={`${label} 기초금액 대비 ${figure.baseRelative}%`} className={SMALL}>
          <span>{figure.baseRelative}%</span>
        </CopyValue>
        {figure.assessmentRate === null ? null : (
          <>
            <span aria-hidden='true'>·</span>
            <CopyValue value={figure.amountCopy} label={`${label} 금액 ${figure.amount}`} className={SMALL}>
              <span>{figure.amount}</span>
            </CopyValue>
          </>
        )}
      </span>
    </span>
  );
}
