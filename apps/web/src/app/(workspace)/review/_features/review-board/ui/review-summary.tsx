/** @module 책임: 복기 한 달의 방법별 성적 표(1등 자리·하한 미달·1등 자리보다 높음·추첨 평균 기대)를 그린다. */
import type { ReviewSummaryRow } from '../model/present-review';

// 머리글은 낱말 단위로 두 줄까지 접어 휴대폰 첫 화면에 핵심 두 열이 들게 한다. 숫자 칸은 접지 않는다.
const HEAD = 'break-keep px-2 py-2.5 text-right align-bottom';
const CELL = 'whitespace-nowrap px-2 py-2.5 text-right';

/** 값이 없던 방법은 0 대신 빈 칸이다. 0은 성적이고 기록 없음은 성적이 아니다. */
const count = (row: ReviewSummaryRow, value: number | string) => (row.empty ? '–' : value);

export function ReviewSummary({ rows }: { readonly rows: readonly ReviewSummaryRow[] }) {
  const most = Math.max(1, ...rows.map((row) => row.first));
  return (
    <section aria-labelledby='review-summary-title' className='mt-6 grid gap-2'>
      <h2 id='review-summary-title' className='text-[17px] font-extrabold tracking-[-0.02em]'>방법별 성적</h2>
      {/*
        휴대폰에서는 표가 옆으로 밀린다. 방법 이름 열을 붙여 두어 밀어도 어느 줄의 숫자인지 놓치지 않고, 이 표가 답하는 두 숫자(1등 자리·
        기대)를 바로 옆에 두어 밀지 않아도 보이게 한다.
      */}
      <div className='overflow-x-auto border-t border-border'>
        <table className='w-full min-w-[620px] border-collapse text-[14px] tabular-nums'>
          <thead>
            <tr className='text-[12px] font-bold text-muted-foreground'>
              <th scope='col' className='sticky left-0 z-10 bg-background px-2 py-2.5 text-left'>방법</th>
              <th scope='col' className={HEAD}>1등 자리에 든 공고</th>
              <th scope='col' className={HEAD}>추첨 평균 기대</th>
              <th scope='col' className={HEAD}>사정률</th>
              <th scope='col' className={HEAD}>공고</th>
              <th scope='col' className={HEAD}>둘 다 하한 미달</th>
              <th scope='col' className={HEAD}>둘 다 1등 자리보다 높음</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={`border-t border-border ${row.lead ? 'bg-accent' : ''}`}>
                <th
                  scope='row'
                  className={`sticky left-0 z-10 min-w-[9.5rem] max-w-[13rem] break-keep px-2 py-2.5 text-left font-bold ${row.lead ? 'bg-accent' : 'bg-background'}`}
                >
                  {row.name}
                  {row.lead ? <span className='ml-1.5 whitespace-nowrap text-[11.5px] font-bold text-primary'>기대 가장 높음</span> : null}
                  <span className='block text-[12px] font-medium text-muted-foreground'>{row.note}</span>
                </th>
                <td className={CELL}>
                  {row.empty ? (
                    '–'
                  ) : (
                    <>
                      <span className='inline-flex items-center justify-end gap-2'>
                        {row.first}
                        {/* 막대는 줄끼리 견주는 보조라 폭이 좁은 휴대폰에서는 숫자에 자리를 내준다. */}
                        <span aria-hidden='true' className='hidden h-2 w-20 overflow-hidden rounded-sm bg-muted sm:block'>
                          <span className='block h-full bg-emerald-600 dark:bg-emerald-400' style={{ width: `${(row.first / most) * 100}%` }} />
                        </span>
                      </span>
                      {row.firstNote === null ? null : <span className='block text-[12px] text-muted-foreground'>{row.firstNote}</span>}
                    </>
                  )}
                </td>
                <td className={CELL}>{count(row, row.expected)}</td>
                <td className={CELL}>{row.values}</td>
                <td className={CELL}>{count(row, row.rounds)}</td>
                <td className={CELL}>{count(row, row.allBelowFloor)}</td>
                <td className={CELL}>{count(row, row.allAboveFirst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
