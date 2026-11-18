/**
 * @module 책임: 마감일 하루의 공고를 하한율 묶음으로 그린다 — 88%는 머리에 사업장별 값 타일을 둔 묶음(값이 같은 공고끼리), 90%와
 * 하한율 미확인은 공고 줄만 둔 묶음이다. 88% 공고의 값을 목록 안 묶음 머리에 두는 이유는 오른쪽 판의 90% 값과 헷갈리지 않게
 * 하려는 것이다(PDR-0011 결정 5). 줄은 읽기만 한다 — 누르는 것은 마감일 칩과 메뉴뿐이다.
 */
import { formatCount } from '@/shared/lib/number-format';
import { cn } from '@/shared/lib/cn';

import type { BusinessValue, ClosingDay, NoticeRow } from '../utils/work-board';

function GroupHead({
  title,
  count,
  tone
}: {
  readonly title: string;
  readonly count: number;
  readonly tone: '88' | 'plain';
}) {
  return (
    <div className='flex items-center gap-2.5 px-6 pt-3.5 pb-2'>
      <h2
        className={cn(
          'rounded-chip px-2.5 py-0.5 text-label font-bold',
          tone === '88' ? 'bg-caution-weak text-caution' : 'bg-muted text-muted-foreground'
        )}
      >
        {title}
      </h2>
      <span className='text-label font-semibold text-ink-3 tabular-nums'>{formatCount(count)}</span>
    </div>
  );
}

function Row({ row }: { readonly row: NoticeRow }) {
  return (
    <li
      data-slot='notice-row'
      className='mx-2 grid min-h-15 grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-4 rounded-control pr-4 pl-4'
    >
      <span
        className={cn(
          'text-label tabular-nums',
          row.unusualTime ? 'font-extrabold text-foreground' : 'font-semibold text-ink-3'
        )}
      >
        {row.time}
      </span>
      <span
        className='min-w-0 truncate text-body font-semibold max-nav:whitespace-normal'
        title={row.organization}
      >
        {row.organization}
      </span>
      {row.bidNo === null ? (
        <span aria-hidden />
      ) : (
        <span className='text-label whitespace-nowrap text-ink-3 tabular-nums'>{row.bidNo}</span>
      )}
    </li>
  );
}

function Rows({ rows }: { readonly rows: readonly NoticeRow[] }) {
  return (
    <ul className='grid pb-1'>
      {rows.map((row) => (
        <Row key={row.auctionId} row={row} />
      ))}
    </ul>
  );
}

function ValueTile({ entry }: { readonly entry: BusinessValue }) {
  return (
    <li className='grid content-start rounded-control bg-caution-weak px-3.5 py-2.5'>
      {/* 업체명은 자르지 않는다 — 사업장이 다섯이어도 누구 값인지 끝까지 읽혀야 한다(#241). */}
      <span className='text-label font-bold break-keep text-muted-foreground'>{entry.name}</span>
      {entry.value === null ? (
        // 값 자리 높이(24px 값 한 줄)를 그대로 지켜 값 있는 타일과 높이를 맞춘다.
        <span className='flex min-h-7.75 items-center text-label font-semibold text-ink-3'>
          {entry.reason}
        </span>
      ) : (
        <span className='text-title font-extrabold tracking-tight tabular-nums'>
          {entry.value}%
        </span>
      )}
    </li>
  );
}

export function NoticeList({ day }: { readonly day: ClosingDay }) {
  const groups = [
    ...day.groups88.map((group) => (
      <section key={`88-${group.key}`} aria-label={`하한 88% ${formatCount(group.rows.length)}`}>
        <GroupHead title='하한 88%' count={group.rows.length} tone='88' />
        <ul
          aria-label='사업장별 값'
          className='grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 px-6 pt-0.5 pb-3'
        >
          {group.values.map((entry, index) => (
            <ValueTile key={`${index}-${entry.name}`} entry={entry} />
          ))}
        </ul>
        <Rows rows={group.rows} />
      </section>
    )),
    day.rows90.length === 0 ? null : (
      <section key='90' aria-label={`하한 90% ${formatCount(day.rows90.length)}`}>
        <GroupHead title='하한 90%' count={day.rows90.length} tone='plain' />
        <Rows rows={day.rows90} />
      </section>
    ),
    day.rowsOther.length === 0 ? null : (
      <section key='other' aria-label={`하한율 미확인 ${formatCount(day.rowsOther.length)}`}>
        <GroupHead title='하한율 미확인' count={day.rowsOther.length} tone='plain' />
        <Rows rows={day.rowsOther} />
      </section>
    )
  ].filter((group) => group !== null);
  return (
    <div className='rounded-panel bg-card py-2'>
      {groups.map((group, index) => (
        <div key={group.key} className={index === 0 ? undefined : 'border-t-8 border-background'}>
          {group}
        </div>
      ))}
    </div>
  );
}
