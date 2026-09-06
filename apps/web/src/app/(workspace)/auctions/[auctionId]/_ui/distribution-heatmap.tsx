/** @module 책임: 크게 보기에서 12개월 × 칸 히트맵을 그리고 수집이 나쁜 달 행에 사유를 붙인다. */
import type { WinRateDistributionV1Response } from '@/api/win-rate-distribution';

import type { LadderPresentation } from '../_model/present-distribution';
import { sampleSizeLabel } from '../_model/sample-size';

// 보유율이 이 값이 아니면 그 달은 분모를 낼 수 없거나 일부만 수집된 구간이다(PDR-0003).
const COVERAGE_REASON: Record<string, string> = {
  none: '수집 안 됨',
  unknown: '분모 미확인',
  partial: '일부 수집'
};

function cellTone(count: number, maxCount: number): string {
  if (count === 0) return 'bg-foreground/5 text-muted-foreground';
  const step = Math.ceil((count / maxCount) * 4);
  return ['bg-foreground/15', 'bg-foreground/25', 'bg-foreground/40 text-background', 'bg-foreground/60 text-background'][step - 1] ?? 'bg-foreground/15';
}

/**
 * 열은 사다리와 같은 창을 쓴다. 달마다 다른 창을 잡으면 "몰린 자리가 움직였나"를 볼 수 없다.
 * 768px에서는 가로 스크롤 컨테이너 안에서 넘친다.
 */
export function DistributionHeatmap({
  months,
  ladder
}: {
  readonly months: WinRateDistributionV1Response['months'];
  readonly ladder: LadderPresentation;
}) {
  const columns = ladder.rows.map((row) => row.fromText);
  const countsByMonth = months.map((month) => {
    const counts = new Map((month.bins ?? []).map((bin) => [bin.from.value, bin.count] as const));
    return { month, cells: columns.map((column) => counts.get(column) ?? 0) };
  });
  const maxCount = Math.max(1, ...countsByMonth.flatMap((row) => row.cells));

  return (
    <div className='min-w-0 overflow-x-auto'>
      <table className='w-full min-w-[640px] border-separate border-spacing-0.5 text-[13px]'>
        <caption className='pb-2 text-left font-medium text-muted-foreground'>
          달마다 값이 몰린 자리. 진할수록 낙찰 횟수가 많습니다.
        </caption>
        <thead>
          <tr>
            <th scope='col' className='text-left font-semibold whitespace-nowrap'>달</th>
            {columns.map((column) => (
              <th key={column} scope='col' className='px-0.5 text-right font-medium whitespace-nowrap tabular-nums text-muted-foreground'>
                {/* 정수부는 코호트마다 같으므로 소수 두 자리만 보여 열이 좁아지게 한다. */}
                {column.slice(-4, -1)}
              </th>
            ))}
            <th scope='col' className='pl-2 text-left font-semibold whitespace-nowrap'>표본</th>
          </tr>
        </thead>
        <tbody>
          {countsByMonth.map(({ month, cells }) => {
            const reason = month.coverage === null ? '분모 미확인' : COVERAGE_REASON[month.coverage];
            return (
              <tr key={month.month} className={reason ? 'opacity-60' : undefined}>
                <th scope='row' className='pr-2 text-left font-semibold whitespace-nowrap tabular-nums'>
                  {month.month}
                </th>
                {cells.map((count, index) => (
                  <td
                    key={columns[index]}
                    className={`px-1 text-right font-medium tabular-nums ${cellTone(count, maxCount)}`}
                  >
                    {count === 0 ? '' : count}
                  </td>
                ))}
                <td className='pl-2 font-medium whitespace-nowrap'>
                  {month.sampleCount.toLocaleString('ko-KR')}
                  {sampleSizeLabel(month.sampleCount) === null ? null : (
                    <span className='text-muted-foreground'> · {sampleSizeLabel(month.sampleCount)}</span>
                  )}
                  {reason ? <span className='text-muted-foreground'> · {reason}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
