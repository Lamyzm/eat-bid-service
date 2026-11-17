/**
 * @module 책임: 열린 공고를 마감일로 묶고, 날마다 하한 88% 묶음(공고마다 사업장별 값)과 90% 묶음(값은 카드에 한 번)을 그린다.
 * 88%와 90%를 한 목록에 섞으면 카드의 90% 값을 88% 공고에 잘못 부르기 쉬워 묶음을 나눈다.
 */
import Link from 'next/link';

import { CopyValue } from '@/shared/ui/copy-value';

import type { ClosingDay, Notice88Row, NoticeRow } from '../model/work-board';

function Time({ row }: { readonly row: NoticeRow }) {
  return (
    <span className={`font-mono text-[17px] tabular-nums ${row.unusualTime ? 'font-bold text-chart-3' : ''}`}>{row.time ?? '—'}</span>
  );
}

function BidNo({ row }: { readonly row: NoticeRow }) {
  if (row.bidNo === null) return <span className='text-[15px] text-muted-foreground'>공고번호 미관측</span>;
  return (
    <CopyValue value={row.bidNo} label={`${row.organization} 공고번호`} chip className='inline-flex items-center gap-1.5 rounded px-1 font-mono text-[16px] tabular-nums hover:underline'>
      {row.bidNo}
    </CopyValue>
  );
}

function Organization({ row }: { readonly row: NoticeRow }) {
  return (
    <Link href={row.href} className='truncate text-[18px] font-bold hover:underline' title={row.organization}>
      {row.organization}
    </Link>
  );
}

function Block88({ rows, businessNames }: { readonly rows: readonly Notice88Row[]; readonly businessNames: readonly string[] }) {
  // 칸 안의 sr-only 글자는 절대 위치라, 기준을 이 상자에 두지 않으면 표 폭만큼 문서를 옆으로 민다.
  return (
    <div className='relative min-w-0 overflow-x-auto rounded-xl bg-card ring-2 ring-chart-3'>
      <table className='w-full min-w-[640px] border-collapse text-left'>
        <caption className='bg-chart-3/10 px-4 py-2.5 text-left text-[16px] font-bold text-chart-3'>
          하한 88% <span className='font-mono'>{rows.length}</span>건
        </caption>
        <thead>
          <tr className='text-[14px] text-muted-foreground'>
            <th scope='col' className='w-[72px] px-4 py-2 font-semibold'>마감</th>
            <th scope='col' className='px-2 py-2 font-semibold'>공고</th>
            <th scope='col' className='px-2 py-2 font-semibold'>공고번호</th>
            {businessNames.map((name, index) => (
              <th key={`${index}-${name}`} scope='col' className='max-w-[120px] truncate px-2 py-2 font-semibold' title={name}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.auctionId} className='h-[52px] border-t border-border'>
              <td className='px-4'><Time row={row} /></td>
              <th scope='row' className='max-w-[280px] px-2 font-normal'><Organization row={row} /></th>
              <td className='px-2'><BidNo row={row} /></td>
              {row.values.map((value, index) => (
                <td key={index} className='px-2'>
                  {value === null ? (
                    <span className='text-muted-foreground'>—<span className='sr-only'>값 없음</span></span>
                  ) : (
                    <CopyValue value={value} label={`${row.organization} ${businessNames[index] ?? ''} 값`} className='rounded font-mono text-[18px] font-bold text-chart-3 tabular-nums hover:underline'>
                      {value}%
                    </CopyValue>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlainBlock({ title, rows }: { readonly title: string; readonly rows: readonly NoticeRow[] }) {
  return (
    <section aria-label={title} className='min-w-0 overflow-hidden rounded-xl bg-card'>
      <p className='bg-muted px-4 py-2.5 text-[16px] font-bold'>
        {title} <span className='font-mono'>{rows.length}</span>건
      </p>
      <ul>
        {rows.map((row) => (
          <li key={row.auctionId} className='grid min-h-[52px] grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-4'>
            <Time row={row} />
            <Organization row={row} />
            <BidNo row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ClosingDays({ days, businessNames }: { readonly days: readonly ClosingDay[]; readonly businessNames: readonly string[] }) {
  if (days.length === 0) return <p className='mt-8 text-[18px] font-bold text-muted-foreground'>넣을 공고 0건</p>;
  return (
    <div className='mt-6 grid gap-8'>
      {days.map((day) => (
        <section key={day.key} aria-labelledby={`work-day-${day.key}`} className='grid min-w-0 gap-3'>
          <h2 id={`work-day-${day.key}`} className='flex items-baseline gap-3 text-[20px] font-extrabold'>
            {day.label} 마감
            <span className='font-mono text-[18px] font-semibold text-muted-foreground'>{day.count}건</span>
          </h2>
          {day.rows88.length === 0 ? null : <Block88 rows={day.rows88} businessNames={businessNames} />}
          {day.rows90.length === 0 ? null : <PlainBlock title='하한 90%' rows={day.rows90} />}
          {day.rowsOther.length === 0 ? null : <PlainBlock title='하한율 미확인' rows={day.rowsOther} />}
        </section>
      ))}
    </div>
  );
}
