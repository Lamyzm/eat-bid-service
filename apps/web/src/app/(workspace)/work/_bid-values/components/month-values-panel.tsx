/**
 * @module 책임: 사업장마다 하한 90% 공고에 넣을 이달 값 판을 그린다. 넓은 창에서는 목록 옆에 따라오는 세로 판이고, 앱 폭이 좁으면
 * 목록 위로 올라가 이름·값 격자로 접힌다. 판에는 단추가 없다 — 값은 사장님이 eaT에 직접 넣는다.
 */
import type { BusinessValue } from '../utils/work-board';

export function MonthValuesPanel({
  monthLabel,
  values
}: {
  readonly monthLabel: string;
  readonly values: readonly BusinessValue[];
}) {
  return (
    <aside
      aria-labelledby='work-month-values'
      className='grid content-start rounded-panel bg-card px-4.5 py-4 @3xl:sticky @3xl:top-[calc(var(--workspace-header-height,0px)+1.5rem)] @3xl:px-5 @3xl:py-5.5'
    >
      <div className='mb-1.5 flex items-center gap-2.5'>
        <h2 id='work-month-values' className='text-body font-bold'>
          {monthLabel}
        </h2>
        <span className='rounded-chip bg-muted px-2.5 py-0.5 text-label font-bold text-muted-foreground'>
          하한 90%
        </span>
      </div>
      <ul className='grid grid-cols-[repeat(auto-fill,minmax(9.375rem,1fr))] gap-x-4 @3xl:grid-cols-1'>
        {values.map((entry, index) => (
          <li
            key={`${index}-${entry.name}`}
            className='grid gap-0.5 py-1 @3xl:border-t @3xl:border-border @3xl:py-3.5 @3xl:first:border-t-0 @3xl:first:pt-2'
          >
            <span className='text-label font-bold break-keep @3xl:text-body'>{entry.name}</span>
            {entry.value === null ? (
              <span className='text-label font-semibold text-muted-foreground'>{entry.reason}</span>
            ) : (
              <span className='text-body font-extrabold tracking-tight tabular-nums @3xl:text-title'>
                {entry.value}%
              </span>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
