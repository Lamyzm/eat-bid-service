/**
 * @module 책임: 오늘 투찰의 화면 안 학교 거르기(검색 칸·남은 건수·지우기)와, 서버가 그린 행·마감 묶음을 검색어에 맞춰 숨기는 얇은
 * 감싸개를 소유한다. 목록 자체는 server component로 남고 여기는 검색어만 쥔다.
 */
'use client';
import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';

import { matchedCount, matchesSchool, schoolFilterStatus, schoolQueryKey, type SchoolFilterTarget } from '../model/school-filter';

interface SchoolFilterState {
  readonly query: string;
  readonly key: string;
  readonly setQuery: (query: string) => void;
  readonly targets: readonly SchoolFilterTarget[];
}

// 감싸개 밖(목록만 따로 그리는 자리)에서는 거르지 않는다 — 검색어가 없는 것과 같다.
const NO_FILTER: SchoolFilterState = { query: '', key: '', setQuery: () => undefined, targets: [] };
const SchoolFilterContext = createContext<SchoolFilterState>(NO_FILTER);

function useSchoolFilter(): SchoolFilterState {
  return useContext(SchoolFilterContext);
}

/** 검색어는 이 화면에만 산다. 서버를 다시 부르지 않고, 새로고침하면 지워진다 — 품목처럼 즐겨찾기할 조건이 아니라 찾는 손짓이다. */
export function SchoolFilterProvider({ targets, children }: { readonly targets: readonly SchoolFilterTarget[]; readonly children: ReactNode }) {
  const [query, setQuery] = useState('');
  const value = useMemo(() => ({ query, key: schoolQueryKey(query), setQuery, targets }), [query, targets]);
  return <SchoolFilterContext.Provider value={value}>{children}</SchoolFilterContext.Provider>;
}

export function SchoolSearch() {
  const { query, key, setQuery, targets } = useSchoolFilter();
  const id = useId();
  const status = schoolFilterStatus(query, matchedCount(key, targets), targets.length);
  return (
    <div className='mt-3 grid gap-1.5'>
      <label htmlFor={id} className='text-[13px] font-bold'>학교 이름으로 찾기</label>
      {/* 브라우저 검색 칸의 자체 지우개는 기기마다 달라 일반 칸에 지우기 단추 하나를 같은 줄에 둔다. */}
      <div className='flex max-w-sm items-center gap-2'>
        <input
          id={id}
          type='text'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='예: 덕정, 율하고'
          autoComplete='off'
          className='h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-base outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30'
        />
        {key === '' ? null : (
          <button
            type='button'
            onClick={() => setQuery('')}
            className='h-11 shrink-0 rounded-lg border border-border px-3 text-sm font-bold text-muted-foreground hover:text-foreground'
          >
            지우기
          </button>
        )}
      </div>
      {/* 몇 건이 남았는지는 고칠 때마다 읽기 도구에도 알린다 — 목록이 소리 없이 줄면 비었는지 못 다룬 건지 모른다. */}
      <p role='status' className='min-h-5 text-sm font-semibold text-foreground tabular-nums'>{status}</p>
    </div>
  );
}

/** 검색어에 맞지 않는 행은 그리지 않는다. */
export function SchoolFilterRow({ target, children }: { readonly target: SchoolFilterTarget; readonly children: ReactNode }) {
  const { key } = useSchoolFilter();
  return matchesSchool(key, target) ? children : null;
}

/** 맞는 행이 하나도 없는 마감 묶음은 머리까지 숨긴다. */
export function SchoolFilterGroup({ targets, children }: { readonly targets: readonly SchoolFilterTarget[]; readonly children: ReactNode }) {
  const { key } = useSchoolFilter();
  return matchedCount(key, targets) === 0 ? null : children;
}

/** 묶음 머리의 건수다. 거르는 중이면 남은 수를 센다. */
export function SchoolGroupCount({ targets }: { readonly targets: readonly SchoolFilterTarget[] }) {
  const { key } = useSchoolFilter();
  return <>{matchedCount(key, targets)}건</>;
}
