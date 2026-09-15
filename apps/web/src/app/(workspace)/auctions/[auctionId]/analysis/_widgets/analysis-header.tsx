/** @module 책임: 구매기관을 중심으로 공고 원문 제목과 확인된 조건·일정을 표시한다. */
import type { AnalysisHeaderView } from '../_lib/present-analysis-header';

export function AnalysisHeader({ header }: { readonly header: AnalysisHeaderView }) {
  return (
    <div className='min-w-0'>
      <div className='mb-3 flex flex-wrap items-center gap-2 text-xs'>
        <span className='rounded bg-primary/10 px-2 py-1 font-medium text-primary'>
          {header.status}
        </span>
        <span className='text-muted-foreground'>
          {header.location} · {header.item}
        </span>
      </div>
      <h1 className='text-2xl font-semibold tracking-tight md:text-[28px]'>
        {header.organization}
      </h1>
      <p className='mt-2 text-sm leading-relaxed text-muted-foreground'>{header.title}</p>
      <dl className='mt-5 flex flex-wrap gap-x-7 gap-y-3'>
        {header.facts.map((fact) => (
          <div key={fact.label} className='flex items-baseline gap-2'>
            <dt className='text-xs text-muted-foreground'>{fact.label}</dt>
            <dd className='text-sm font-semibold tabular-nums'>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <details className='mt-4 text-xs'>
        <summary className='w-fit cursor-pointer text-muted-foreground underline underline-offset-4'>
          공고 정보
        </summary>
        <dl className='mt-3 flex flex-wrap gap-x-8 gap-y-3 rounded-lg bg-muted/50 p-4'>
          {header.details.map((fact) => (
            <div key={fact.label}>
              <dt className='text-muted-foreground'>{fact.label}</dt>
              <dd className='mt-1'>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
