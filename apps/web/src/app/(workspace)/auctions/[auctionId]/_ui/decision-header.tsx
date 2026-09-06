/** @module 책임: 기관 제목과 화면 전체 조건(품목·기간·모집단) 칩을 표시한다. 조건 변경은 후속 슬라이스의 client 칩이 맡는다. */
import type { DecisionSearch } from '../_lib/decision-search-params';
import type { DecisionPresentation } from '../_model/present-decision';

// children을 별도 span으로 감싸 tail(꼬리 라벨·드롭다운 표시)이 붙어도 값 텍스트가 단독 노드로 남게 한다.
function Chip({ children, tail }: { readonly children: React.ReactNode; readonly tail?: string }) {
  return (
    <span className='inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold whitespace-nowrap text-foreground'>
      <span>{children}</span>
      {tail ? <span className='text-[13px] font-semibold text-muted-foreground'>{tail}</span> : null}
    </span>
  );
}

export function DecisionHeader({ decision, search }: { readonly decision: DecisionPresentation; readonly search: DecisionSearch }) {
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-3'>
      {/* 제목은 nowrap 대상이 아니다: 전역적으로 글자 잘림을 두지 않으므로 truncate 대신 줄바꿈을 허용한다. */}
      <h1 id='decision-title' className='min-w-0 break-keep text-xl font-bold tracking-tight'>{decision.identity.title}</h1>
      {/* 정보 값이므로 본문 15px를 쓴다. 13px는 단위 꼬리·보조 라벨 전용이다. */}
      <span className='text-[15px] font-semibold whitespace-nowrap text-muted-foreground'>공고 {decision.identity.displayBidNumber ?? '미확인'} · 하한율 {decision.floorRateText}</span>
      <div className='ml-auto flex items-center gap-2'>
        <Chip tail='공고 기준'>{decision.itemLabelText}</Chip>
        {/* 기간·모집단은 후속 슬라이스에서 드롭다운이 되므로 드롭다운 표시를 tail로 미리 붙인다. */}
        <Chip tail='▾'>{search.period}</Chip>
        <Chip tail='▾'>{search.scope}</Chip>
      </div>
    </div>
  );
}
