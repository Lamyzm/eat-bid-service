/** @module 책임: 달력 아래 검색 칸 하나를 GET form으로 그린다. 검색어는 주소에 살고 나머지 조건은 hidden으로 함께 실리며, 검색 중이면 범위·건수 문장과 지우기 링크를 붙인다. */
import Link from 'next/link';

import type { ListSearchPresentation } from '../model/present-list-search';

const SEARCH_LABEL = '학교 이름이나 공고로 찾기';

export function ListSearchForm({ search }: { readonly search: ListSearchPresentation }) {
  return (
    // 이름은 `label`이 갖는다. form에 `aria-label`을 한 번 더 주면 같은 이름이 두 자리에 산다(eatbid-web-accessibility §3).
    <form method='get' action='/today' role='search' className='grid min-w-0 gap-1.5'>
      {search.carried.map(({ key, value }) => <input key={key} type='hidden' name={key} value={value} />)}
      {/* 눈에는 placeholder가 같은 문구를 보이지만 placeholder는 채우면 사라지므로 이름은 label이 소유한다. */}
      <label htmlFor='today-search' className='sr-only'>{SEARCH_LABEL}</label>
      <div className='flex min-w-0 gap-1.5'>
        {/* 시안 U9의 검색 칸은 달력 아래 한 줄, 둥근 muted 상자다. 조건 기둥이 아니라 본문에 있는 이유는 조건이 아니라
            "이 조건 안에서 찾기"이기 때문이다 — 기둥에 두면 지역·품목과 같은 층으로 읽힌다. */}
        <input
          id='today-search'
          name='q'
          type='search'
          defaultValue={search.valueText}
          placeholder={SEARCH_LABEL}
          maxLength={64}
          autoComplete='off'
          className='h-11 min-w-0 flex-1 rounded-xl bg-foreground/5 px-4 text-[15px] font-medium placeholder:text-muted-foreground'
        />
        <button type='submit' className='inline-flex h-11 shrink-0 items-center rounded-xl bg-foreground/5 px-4 text-[15px] font-semibold hover:bg-foreground/10'>
          찾기
        </button>
      </div>
      {search.active === null ? null : (
        <p className='flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold text-muted-foreground'>
          <span>{search.active.text}</span>
          <Link href={search.active.clearHref} className='text-foreground hover:underline'>검색 지우기</Link>
        </p>
      )}
    </form>
  );
}
