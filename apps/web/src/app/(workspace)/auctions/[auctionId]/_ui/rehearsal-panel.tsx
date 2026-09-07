/** @module 책임: 손잡이가 가리키는 값을 선택 품목의 과거 회차에 적용한 "이 값이면" 결과를 레일 안에 보인다. */
'use client';

import type { HistoryRow } from '../_model/attempt-history';
import { rehearse, type Rehearsal } from '../_model/rehearsal';
import { REHEARSAL_PHRASE } from '../_model/verdict-vocabulary';
import { useBidRate } from './bid-rate-context';

// 칸 하나가 회차 하나다. 이보다 많아지면 칸이 1px 아래로 뭉개져 세는 뜻을 잃으므로 비율 막대로 바꾼다.
const CELL_LIMIT = 24;

// 값은 16px, 그 뒤 분모·비율 같은 꼬리만 13px muted다. 라벨을 13px로 내리지 않는다.
function StatRow({
  label,
  sub,
  value,
  tail,
  tone
}: {
  readonly label: string;
  readonly sub?: string;
  readonly value: string;
  readonly tail?: string;
  readonly tone?: string;
}) {
  return (
    <div className='grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-t border-border py-[11px]'>
      <span className='flex min-w-0 flex-col gap-px'>
        <span className='text-[15px] font-semibold'>{label}</span>
        {sub ? <span className='text-[15px] font-medium whitespace-nowrap text-muted-foreground'>{sub}</span> : null}
      </span>
      <span className={`text-[16px] font-semibold tabular-nums whitespace-nowrap ${tone ?? ''}`}>
        {value}
        {tail ? <span className='text-[13px] font-semibold text-muted-foreground'> {tail}</span> : null}
      </span>
    </div>
  );
}

// 칸 스트립은 바로 위 행이 이미 숫자로 읽어 준 값을 그림으로 되풀이한다. 보조기술에는 칸 수십 개가
// 의미 없는 잡음이라 감춘다.
function WonCells({ wonFlags }: { readonly wonFlags: readonly boolean[] }) {
  return (
    <div aria-hidden='true' className='flex gap-[3px] pb-2'>
      {wonFlags.map((won, index) => (
        <span key={index} className={`h-2.5 flex-1 rounded-sm ${won ? 'bg-primary' : 'bg-border'}`} />
      ))}
    </div>
  );
}

function WonYears({ byYear, won, total }: { readonly byYear: Rehearsal['byYear']; readonly won: number; readonly total: number }) {
  return (
    <div className='grid gap-1 pb-2'>
      <div className='h-2.5 overflow-hidden rounded-sm bg-border'>
        <span className='block h-2.5 bg-primary' style={{ width: `${(won / total) * 100}%` }} />
      </div>
      {byYear.map((bucket) => (
        <div key={bucket.year} className='grid grid-cols-[44px_1fr_72px] items-center gap-x-3'>
          <span className='text-[13px] font-semibold text-muted-foreground'>{bucket.year}</span>
          <span className='block h-1.5 overflow-hidden rounded-sm bg-border'>
            <span className='block h-1.5 bg-primary' style={{ width: `${bucket.total === 0 ? 0 : (bucket.won / bucket.total) * 100}%` }} />
          </span>
          <span className={`text-right text-[15px] font-semibold tabular-nums ${bucket.won > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
            {bucket.won} <span className='text-[13px] font-medium text-muted-foreground'>/ {bucket.total}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function RehearsalPanel({ rows }: { readonly rows: readonly HistoryRow[] }) {
  const { rate } = useBidRate();
  const result = rehearse(rows, rate);
  const byCells = result.total <= CELL_LIMIT;

  return (
    <div className='flex flex-col'>
      <span className='pt-1 pb-1 text-[15px] font-semibold'>이 값이면</span>
      {result.total === 0 ? (
        <p className='pb-2 text-[15px] font-medium text-muted-foreground'>비교할 회차가 없습니다</p>
      ) : (
        <>
          {/* 판정어는 verdict-vocabulary가 소유한다. 소스에 없는 판정(무효 등)을 여기서 만들지 않는다(PDR-0002). */}
          <StatRow
            label={`지난 ${result.total}회 중 ${REHEARSAL_PHRASE.won.text}`}
            sub={REHEARSAL_PHRASE.won.sub}
            value={`${result.won}회`}
            // 칸 스트립은 칸을 세면 비율이 보이지만 비율 막대는 그렇지 않아 숫자로 함께 말한다.
            tail={byCells ? undefined : `${Math.round((result.won / result.total) * 100)}%`}
            tone='text-primary'
          />
          {byCells ? <WonCells wonFlags={result.wonFlags} /> : <WonYears byYear={result.byYear} won={result.won} total={result.total} />}
          {result.belowDayFloor > 0 ? (
            <StatRow
              label={REHEARSAL_PHRASE.belowDayFloor.text}
              sub={REHEARSAL_PHRASE.belowDayFloor.sub}
              value={`${result.belowDayFloor}회`}
              // 낙찰 행과 같은 분모를 명시한다. 두 행이 다른 기간을 말하는 것처럼 읽히면 안 된다.
              tail={`${result.total}회 중`}
              tone='text-destructive'
            />
          ) : null}
          <StatRow
            label='보통 참여 업체'
            sub='그 회차에 참여한 업체 수'
            value={result.usualListCount === null ? '기록 없음' : `${result.usualListCount}곳`}
            tone={result.usualListCount === null ? 'text-muted-foreground' : undefined}
          />
        </>
      )}
    </div>
  );
}
