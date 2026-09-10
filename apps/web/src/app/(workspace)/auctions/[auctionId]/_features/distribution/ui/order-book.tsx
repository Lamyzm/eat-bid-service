/** @module 책임: 낙찰 사정률 사다리를 표로 그리고 최빈 구간·내 값 줄을 색이 아닌 텍스트로도 표시한다. */
import type { LadderPresentation } from '../model/present-distribution';

/**
 * 막대는 장식이고 접근 가능한 내용은 숫자다. 화면 낭독기에 "88% 길이의 막대"를 읽어 주면 값이 아니라
 * 그리기 방식을 읽는 것이므로 `aria-hidden`으로 숨긴다(screen-system 2.1-6).
 */
function Bar({ ratio }: { readonly ratio: number }) {
  return (
    <span aria-hidden='true' className='block h-2 rounded-sm bg-foreground/15'>
      <span
        className='block h-2 rounded-sm bg-foreground/70'
        style={{ width: `${Math.round(ratio * 100)}%` }}
      />
    </span>
  );
}

function OutsideWindow({ count, direction }: { readonly count: number; readonly direction: '위' | '아래' }) {
  if (count === 0) return null;
  // 창 밖 표본을 숨기면 사다리가 표본 전부를 보여 준다고 거짓말한다(AGENTS 7).
  return (
    <p className='text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>
      창 {direction} 낙찰 {count.toLocaleString('ko-KR')}건
    </p>
  );
}

export function OrderBook({
  ladder,
  caption
}: {
  readonly ladder: LadderPresentation;
  readonly caption: string;
}) {
  return (
    <div className='grid min-w-0 gap-1'>
      <OutsideWindow count={ladder.aboveWindowCount} direction='위' />
      <div className='min-w-0 overflow-x-auto'>
        <table className='w-full min-w-[280px] border-separate border-spacing-y-0.5 text-[15px]'>
          <caption className='pb-2 text-left text-[13px] font-medium text-muted-foreground'>{caption}</caption>
          {/*
            열 이름을 `sr-only`로 숨기면 `position: absolute`가 thead를 표 상자 밖으로 빼내 `scope='col'`
            연결이 끊기고, 1px 상자 안에서 nowrap 글자가 잘려 폭 검사(decision-screen.spec.ts)에도 걸린다.
            열 이름은 표 흐름 안에 그대로 두고 시각적으로만 낮춘다.
          */}
          <thead>
            <tr className='text-[13px] font-medium text-muted-foreground'>
              <th scope='col' className='pr-2 pb-1 text-left font-medium whitespace-nowrap'>
                사정률
              </th>
              <th scope='col' className='pr-2 pb-1 text-right font-medium whitespace-nowrap'>
                낙찰
              </th>
              <th scope='col' className='pb-1 text-left font-medium whitespace-nowrap'>
                분포
              </th>
            </tr>
          </thead>
          <tbody>
            {/* 위가 높은 값이다. 사다리는 하한율에서 위로 쌓이므로 역순으로 그린다. */}
            {ladder.rows.toReversed().map((row) => (
              <tr
                key={row.fromText}
                aria-current={row.isMyRate ? 'true' : undefined}
                className={row.isMyRate ? 'bg-primary/10' : undefined}
              >
                <th
                  scope='row'
                  className={`w-[7.5rem] py-0.5 pr-2 text-left font-medium whitespace-nowrap tabular-nums ${
                    row.inModeRange ? 'font-semibold text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {row.fromText}
                </th>
                <td className='w-12 py-0.5 pr-2 text-right font-semibold tabular-nums'>
                  {row.count === 0 ? <span className='text-muted-foreground'>0</span> : row.count}
                </td>
                <td className='py-0.5'>
                  <span className='flex items-center gap-2'>
                    <span className='min-w-0 flex-1'>
                      <Bar ratio={row.barRatio} />
                    </span>
                    {/* 색만으로 구간을 전하지 않는다. 구간 시작 줄과 내 값 줄에 텍스트 표식을 붙인다. */}
                    {row.inModeRange ? (
                      <span className='text-[13px] font-semibold whitespace-nowrap'>많이 나온 값</span>
                    ) : null}
                    {row.isMyRate ? (
                      <span className='text-[13px] font-semibold whitespace-nowrap text-primary'>내 값</span>
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <OutsideWindow count={ladder.belowWindowCount} direction='아래' />
    </div>
  );
}
