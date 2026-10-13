/** @module 책임: 복기 한 달의 방법별 성적 표(1등 자리·하한 미달·낙찰보다 높음·추첨 평균 기대)를 그린다. */
import type { ReviewSummaryRow } from '../model/present-review';

export function ReviewSummary({ rows }: { readonly rows: readonly ReviewSummaryRow[] }) {
  const most = Math.max(1, ...rows.map((row) => row.first));
  return (
    <section aria-labelledby='review-summary-title' className='mt-6 grid gap-2'>
      <h2 id='review-summary-title' className='text-[17px] font-extrabold tracking-[-0.02em]'>방법별 성적</h2>
      <div className='overflow-x-auto border-t border-border'>
        <table className='w-full min-w-[640px] border-collapse text-[14px] tabular-nums'>
          <thead>
            <tr className='text-[12px] font-bold text-muted-foreground'>
              <th scope='col' className='px-2 py-2.5 text-left'>방법</th>
              <th scope='col' className='px-2 py-2.5 text-right'>사정률</th>
              <th scope='col' className='px-2 py-2.5 text-right'>공고</th>
              <th scope='col' className='px-2 py-2.5 text-right'>1등 자리에 든 공고</th>
              <th scope='col' className='px-2 py-2.5 text-right'>둘 다 하한 미달</th>
              <th scope='col' className='px-2 py-2.5 text-right'>둘 다 낙찰보다 높음</th>
              <th scope='col' className='px-2 py-2.5 text-right'>추첨 평균 기대</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={`border-t border-border ${row.lead ? 'bg-accent' : ''}`}>
                <th scope='row' className='px-2 py-2.5 text-left font-bold'>
                  {row.name}
                  {row.lead ? <span className='ml-1.5 text-[11.5px] font-bold text-primary'>기대 가장 높음</span> : null}
                  <span className='block text-[12px] font-medium text-muted-foreground'>{row.note}</span>
                </th>
                <td className='px-2 py-2.5 text-right'>{row.values}</td>
                <td className='px-2 py-2.5 text-right'>{row.rounds}</td>
                <td className='px-2 py-2.5 text-right'>
                  <span className='inline-flex items-center justify-end gap-2'>
                    {row.firstText}
                    <span aria-hidden='true' className='h-2 w-20 overflow-hidden rounded-sm bg-muted'>
                      <span className='block h-full bg-emerald-600 dark:bg-emerald-400' style={{ width: `${(row.first / most) * 100}%` }} />
                    </span>
                  </span>
                </td>
                <td className='px-2 py-2.5 text-right'>{row.allBelowFloor}</td>
                <td className='px-2 py-2.5 text-right'>{row.allAboveWinner}</td>
                <td className='px-2 py-2.5 text-right'>{row.expected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
