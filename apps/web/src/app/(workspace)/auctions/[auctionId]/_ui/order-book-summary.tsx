/** @module 책임: 사다리 위에 많이 나온 값·중앙 칸·내 값 대비 낙찰 수를 문장 셋으로 요약한다. */
import type { LadderPresentation } from '../_model/present-distribution';

function Line({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <p className='flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[15px] font-medium'>
      <span className='text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>{label}</span>
      <span className='min-w-0 tabular-nums'>{children}</span>
    </p>
  );
}

export function OrderBookSummary({ ladder }: { readonly ladder: LadderPresentation }) {
  return (
    <div className='grid gap-1'>
      {ladder.modeText === null ? null : (
        <Line label='많이 나온 값'>
          {ladder.modeText}
          {ladder.modeSharePercentText === null ? null : (
            <span className='text-[13px] font-semibold text-muted-foreground'> · 전체의 {ladder.modeSharePercentText}</span>
          )}
        </Line>
      )}
      {ladder.medianText === null ? null : <Line label='중앙'>{ladder.medianText}</Line>}
      {/* 내 값을 놓지 않았으면 셋째 문장을 그리지 않는다. 기본값을 지어내면 그것이 추천이 된다. */}
      {ladder.myRate === null ? null : (
        <Line label={`내 값 ${ladder.myRate.text}`}>
          낮게 낙찰 {ladder.myRate.lowerCount.toLocaleString('ko-KR')}
          <span className='text-muted-foreground'> · </span>
          위 {ladder.myRate.higherCount.toLocaleString('ko-KR')}
          <span className='text-muted-foreground'> · </span>
          {/* 같은 값은 추첨이라 낮게에 넣으면 거짓이다. 같은 칸으로 따로 센다. */}
          같은 칸 {ladder.myRate.sameCount.toLocaleString('ko-KR')}
        </Line>
      )}
    </div>
  );
}
