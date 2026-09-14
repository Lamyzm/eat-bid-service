/** @module 책임: 새 분석 자료가 준비되기 전의 비교 맥락과 표본·자료 기준 미확인 상태를 표시한다. */
import type { AnalysisContextView } from '../_features/analysis-filters/model/present-analysis-context';

export function AnalysisContext({ context }: { readonly context: AnalysisContextView }) {
  if (context.state === 'invalid')
    return (
      <div>
        <h2 className='text-lg font-semibold'>{context.title}</h2>
        <p className='mt-2 text-sm text-muted-foreground'>{context.description}</p>
      </div>
    );
  return (
    <div>
      <h2 className='text-lg font-semibold tracking-tight md:text-xl'>
        <span className='text-primary'>{context.organization}</span>{' '}
        <span className='mx-2 text-sm font-normal text-muted-foreground'>vs</span>{' '}
        {context.comparison} 전체
      </h2>
      <p className='mt-2 text-xs leading-relaxed text-muted-foreground'>
        {context.description} · {context.method}
      </p>
      <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
        지역/전국 전체는 조건에 맞는 이 기관의 기록을 포함해요. 이 기관은 전체 품목이에요.
      </p>
      <dl className='mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs'>
        <div className='flex items-center gap-2'>
          <dt className='font-medium text-primary'>{context.organization}</dt>
          <dd className='text-muted-foreground'>표본 미확인</dd>
        </div>
        <div className='flex items-center gap-2'>
          <dt>{context.comparison} 전체</dt>
          <dd className='text-muted-foreground'>표본 미확인</dd>
        </div>
      </dl>
    </div>
  );
}
export function AnalysisPendingPlot({ kind }: { readonly kind: 'time' | 'distribution' }) {
  return (
    <>
      <div className='analysis-empty-plot'>
        <div className='max-w-sm'>
          <span className='mb-4 inline-block rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground'>
            분석 자료 준비 중
          </span>
          <h3 className='text-base font-semibold'>
            {kind === 'time'
              ? '기관과 지역의 낙찰 추이를 보여드릴게요'
              : '같은 구간으로 낙찰값 분포를 보여드릴게요'}
          </h3>
          <p className='mt-3 text-sm leading-relaxed text-muted-foreground'>
            선택한 조건으로 비교할 자료가 아직 준비되지 않았어요.
            <br />
            표본 수와 수집 범위가 확인되면 함께 표시돼요.
          </p>
        </div>
      </div>
      <p className='px-[var(--analysis-padding)] pb-5 text-xs text-muted-foreground'>
        자료 기준 미확인 · 추이·분포·전체 이력은 같은 자료 기준을 사용해요.
      </p>
    </>
  );
}
export function AnalysisHistoryPending() {
  return (
    <>
      <div className='analysis-history-heading'>
        <h2 className='text-xl font-semibold tracking-tight'>전체 개찰 이력</h2>
        <p className='mt-2 text-xs leading-relaxed text-muted-foreground'>
          위 분석과 같은 조회 조건의 전체 개찰 이력을 보여드려요. 차트 표시 범위 밖 기록도 포함해요.
        </p>
      </div>
      <div className='analysis-history-scroll'>
        <table className='analysis-history-table'>
          <caption className='sr-only'>선택 조건에 해당하는 전체 개찰 이력 · 자료 준비 중</caption>
          <thead>
            <tr>
              {['개찰일', '기관·품목', '낙찰 사정률', '낙찰업체', '명단', '기초금액', '기록'].map(
                (label) => (
                  <th scope='col' key={label}>
                    {label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={7}>같은 조건의 이력을 준비하고 있어요.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
