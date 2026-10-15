/** @module 책임: 달마다 하한선이 가장 많이 나온 칸을 표로 그린다. 이번 달 줄이 맨 위에 서고 지난 달이 최근 순으로 이어진다. */
import type { MonthsView } from '../model/present-months';

const HEADERS = ['가장 많이 나온 칸(사정률)', '그 칸에 든 공고', '기초금액 대비', '1억 공고면'] as const;

export function MonthsTable({ view, focusMonth }: { readonly view: MonthsView; readonly focusMonth: string | null }) {
  return (
    <div className='grid gap-2'>
      <p className='text-[14px] text-muted-foreground sm:hidden'>옆으로 밀면 기초금액 대비 %와 1억 공고 금액이 더 있어요.</p>
      <div className='overflow-x-auto rounded-xl border border-border'>
        <table className='w-full border-separate border-spacing-0 text-[14px] tabular-nums'>
          <thead>
            <tr>
              <th scope='col' className='sticky left-0 z-[2] h-[34px] border-r border-b border-border bg-background px-2.5 text-left text-[13px] font-semibold whitespace-nowrap'>
                달
              </th>
              {HEADERS.map((header) => (
                <th key={header} scope='col' className='h-[34px] max-w-[7.5rem] border-b border-border bg-background px-3 py-1 text-[13px] leading-tight font-semibold text-muted-foreground sm:max-w-none sm:whitespace-nowrap'>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className='bg-muted/60'>
              <th scope='row' className='sticky left-0 z-[1] h-10 border-r border-border bg-muted px-2.5 text-left font-bold whitespace-nowrap'>
                {view.current.label}
              </th>
              <td colSpan={4} className='px-3 text-left'>
                {view.current.text}
              </td>
            </tr>
            {view.rows.map((row) => (
              // 복기에서 고른 달은 줄 바탕을 칠하고 이름 옆에 글로도 적는다(색만으로 말하지 않는다).
              <tr key={row.month} aria-current={row.month === focusMonth ? 'true' : undefined} className={row.month === focusMonth ? 'bg-primary/10' : undefined}>
                <th
                  scope='row'
                  className={`sticky left-0 z-[1] h-10 border-t border-r border-border px-2.5 text-left font-bold whitespace-nowrap ${row.month === focusMonth ? 'bg-primary/10' : 'bg-background'}`}
                >
                  {row.label}
                  {row.month === focusMonth ? <span className='ml-1.5 text-[12px] font-semibold text-primary'>복기에서 고른 달</span> : null}
                </th>
                {row.kind === 'thin' ? (
                  <td colSpan={4} className='border-t border-border px-3 text-left text-muted-foreground'>
                    {row.note}
                  </td>
                ) : (
                  row.cells.map((cell, index) => (
                    <td key={HEADERS[index]} className={`border-t border-border px-3 text-center whitespace-nowrap${index === 0 ? ' font-bold' : ''}`}>
                      {cell}
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
