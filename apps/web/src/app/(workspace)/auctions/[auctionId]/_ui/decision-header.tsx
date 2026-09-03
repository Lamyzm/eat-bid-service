/** @module 책임: 기관 제목과 화면 전체 조건(품목·기간·모집단) 칩을 표시한다. 조건 변경은 후속 슬라이스의 client 칩이 맡는다. */
import type { DecisionSearch } from '../_lib/decision-search-params';
import type { DecisionPresentation } from '../_model/present-decision';

function Chip({ children, tail }: { readonly children: React.ReactNode; readonly tail?: string }) {
  return (
    <span className='inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold whitespace-nowrap text-foreground'>
      {children}
      {tail ? <span className='text-[13px] font-semibold text-muted-foreground'>{tail}</span> : null}
    </span>
  );
}

export function DecisionHeader({ decision, search }: { readonly decision: DecisionPresentation; readonly search: DecisionSearch }) {
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-3'>
      {/* 제목은 nowrap 대상이 아니다: 전역적으로 글자 잘림을 두지 않으므로 truncate 대신 줄바꿈을 허용한다. */}
      <h1 id='decision-title' className='min-w-0 break-keep text-xl font-bold tracking-tight'>{decision.identity.title}</h1>
      <span className='text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>공고 {decision.identity.displayBidNumber ?? '미확인'} · 하한율 미확인</span>
      <div className='ml-auto flex items-center gap-2'>
        <Chip tail='공고 기준'>품목 미확인</Chip>
        <Chip>{search.period}</Chip>
        <Chip>{search.scope}</Chip>
      </div>
    </div>
  );
}
