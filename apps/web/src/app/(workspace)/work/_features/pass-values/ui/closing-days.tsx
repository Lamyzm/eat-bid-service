/**
 * @module 책임: 열린 공고를 마감일로 묶고, 날마다 하한 88% 묶음(공고마다 사업장별 값)과 90% 묶음(값은 카드에 한 번)을 그린다.
 * 88%와 90%를 한 목록에 섞으면 카드의 90% 값을 88% 공고에 잘못 부르기 쉬워 묶음을 나눈다. 묶음들은 같은 칸 폭을 써서 마감·공고·
 * 공고번호가 아래위로 같은 자리에 선다.
 */
import Link from 'next/link';

import { CopyValue } from '@/shared/ui/copy-value';
import { Icons } from '@/shared/ui/icons';

import type { ClosingDay, Notice88Row, NoticeRow } from '../model/work-board';

const NONE = (label: string) => (
  <span className='text-[17px] text-muted-foreground'>—<span className='sr-only'>{label} 없음</span></span>
);

function Time({ row }: { readonly row: NoticeRow }) {
  return (
    <span className={`font-mono text-[18px] tabular-nums ${row.unusualTime ? 'font-bold text-chart-3' : ''}`}>{row.time ?? '—'}</span>
  );
}

function BidNo({ row }: { readonly row: NoticeRow }) {
  if (row.bidNo === null) return NONE('공고번호');
  return (
    <CopyValue value={row.bidNo} label={`${row.organization} 공고번호`} className='inline-flex items-center gap-1.5 rounded font-mono text-[17px] tabular-nums hover:underline'>
      {row.bidNo}
      <Icons.copy aria-hidden className='size-5 text-muted-foreground' />
    </CopyValue>
  );
}

function Organization({ row }: { readonly row: NoticeRow }) {
  return (
    <Link href={row.href} className='block truncate text-[18px] font-bold hover:underline' title={row.organization}>
      {row.organization}
    </Link>
  );
}

/** 묶음 표 셋이 같은 칸 폭을 쓴다. 사업장 열은 88% 표만 채우고 나머지는 빈 자리로 둬 공고번호가 같은 자리에 선다. */
function Columns({ businesses }: { readonly businesses: number }) {
  return (
    <colgroup>
      <col className='w-[88px]' />
      <col />
      <col className='w-[250px]' />
      {Array.from({ length: businesses }, (_, index) => <col key={index} className='w-[130px]' />)}
    </colgroup>
  );
}

function Head({ title, count, tone }: { readonly title: string; readonly count: number; readonly tone: '88' | 'plain' }) {
  return (
    <caption className={`px-4 py-2.5 text-left ${tone === '88' ? 'bg-chart-3/10' : 'bg-muted'}`}>
      <span className={`inline-flex items-center gap-2 rounded-md px-2.5 py-0.5 text-[17px] font-bold ${tone === '88' ? 'bg-chart-3 text-background' : ''}`}>
        {title}
      </span>
      <span className='ml-2 font-mono text-[17px] font-bold'>{count}건</span>
    </caption>
  );
}

function Block({
  title,
  tone,
  rows,
  businessNames
}: {
  readonly title: string;
  readonly tone: '88' | 'plain';
  readonly rows: readonly (NoticeRow | Notice88Row)[];
  readonly businessNames: readonly string[];
}) {
  const withValues = tone === '88';
  // 칸 안의 sr-only 글자는 절대 위치라, 기준을 이 상자에 두지 않으면 표 폭만큼 문서를 옆으로 민다.
  return (
    <div className={`relative min-w-0 overflow-x-auto rounded-xl bg-card ${withValues ? 'ring-2 ring-chart-3' : 'ring-1 ring-border'}`}>
      <table className='w-full min-w-[640px] table-fixed border-collapse text-left'>
        <Head title={title} count={rows.length} tone={tone} />
        <Columns businesses={businessNames.length} />
        <thead>
          <tr className='text-[16px] text-muted-foreground'>
            <th scope='col' className='px-4 py-2 font-semibold'>마감</th>
            <th scope='col' className='px-2 py-2 font-semibold'>공고</th>
            <th scope='col' className='px-2 py-2 font-semibold'>공고번호</th>
            {businessNames.map((name, index) => (
              <th key={`${index}-${name}`} scope='col' className='truncate px-2 py-2 font-bold text-foreground' title={name}>
                {withValues ? name : <span className='sr-only'>{name}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.auctionId} className='h-[54px] border-t border-border'>
              <td className='px-4'><Time row={row} /></td>
              <th scope='row' className='px-2 font-normal'><Organization row={row} /></th>
              <td className='px-2'><BidNo row={row} /></td>
              {businessNames.map((name, index) => {
                if (!withValues || !('values' in row)) return <td key={index} aria-hidden />;
                const value = row.values[index] ?? null;
                return (
                  <td key={index} className='px-2'>
                    {value === null ? NONE(`${name} 값`) : (
                      <CopyValue value={value} label={`${row.organization} ${name} 값`} className='rounded font-mono text-[19px] font-bold text-chart-3 tabular-nums hover:underline'>
                        {value}%
                      </CopyValue>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ClosingDays({ days, businessNames }: { readonly days: readonly ClosingDay[]; readonly businessNames: readonly string[] }) {
  if (days.length === 0) return <p className='mt-8 text-[18px] font-bold text-muted-foreground'>넣을 공고 0건</p>;
  return (
    <div className='mt-6 grid gap-8'>
      {days.map((day) => (
        <section key={day.key} aria-labelledby={`work-day-${day.key}`} className='grid min-w-0 gap-3'>
          <h2 id={`work-day-${day.key}`} className='flex items-baseline gap-3 text-[21px] font-extrabold'>
            {day.label} 마감
            <span className='font-mono text-[18px] font-semibold text-muted-foreground'>{day.count}건</span>
          </h2>
          {day.rows88.length === 0 ? null : <Block title='하한 88%' tone='88' rows={day.rows88} businessNames={businessNames} />}
          {day.rows90.length === 0 ? null : <Block title='하한 90%' tone='plain' rows={day.rows90} businessNames={businessNames} />}
          {day.rowsOther.length === 0 ? null : <Block title='하한율 미확인' tone='plain' rows={day.rowsOther} businessNames={businessNames} />}
        </section>
      ))}
    </div>
  );
}
