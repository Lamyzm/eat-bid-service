/** @module 책임: 손잡이가 가리키는 값을 선택 품목의 과거 회차에 적용한 "이 값이면" 결과를 레일 안에 보인다. */
'use client';

import type { HistoryRow } from '../_model/attempt-history';
import { rehearse, type Rehearsal } from '../_model/rehearsal';
import { useBidRate } from './bid-rate-context';

// 칸 하나가 회차 하나다. 이보다 많아지면 칸이 1px 아래로 뭉개져 세는 뜻을 잃으므로 비율 막대로 바꾼다.
const CELL_LIMIT = 24;

function StatRow({
  label,
  sub,
  value,
  tone
}: {
  readonly label: string;
  readonly sub?: string;
  readonly value: string;
  readonly tone?: string;
}) {
  return (
    <div className='grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-t border-border py-[11px]'>
      <span className='flex min-w-0 flex-col gap-px'>
        <span className='text-[15px] font-semibold'>{label}</span>
        {sub ? <span className='text-[15px] font-medium whitespace-nowrap text-muted-foreground'>{sub}</span> : null}
      </span>
      <span className={`text-[16px] font-semibold tabular-nums whitespace-nowrap ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

function WonCells({ wonFlags }: { readonly wonFlags: readonly boolean[] }) {
  return (
    <div className='flex gap-[3px] pb-2'>
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

  return (
    <div className='flex flex-col'>
      <span className='pt-1 pb-1 text-[15px] font-semibold'>이 값이면</span>
      {result.total === 0 ? (
        <p className='pb-2 text-[15px] font-medium text-muted-foreground'>비교할 회차가 없습니다</p>
      ) : (
        <>
          <StatRow label={`지난 ${result.total}회 중 낙찰됐을 회차`} sub='지금 값을 그때 냈다면' value={`${result.won}회`} tone='text-primary' />
          {result.total <= CELL_LIMIT ? (
            <WonCells wonFlags={result.wonFlags} />
          ) : (
            <WonYears byYear={result.byYear} won={result.won} total={result.total} />
          )}
          {result.invalid > 0 ? (
            <StatRow
              label='그날 하한보다 낮아 무효였을 회차'
              sub='그날 하한: 추첨 뒤 실제로 적용된 하한'
              value={`${result.invalid}회`}
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
