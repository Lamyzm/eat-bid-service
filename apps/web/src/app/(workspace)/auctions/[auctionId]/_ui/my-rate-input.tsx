/** @module 책임: 호가창에 얹을 사정률 축 "내 값"을 사용자가 직접 입력해 URL로 보존하게 한다. */
'use client';

import Link from 'next/link';
import { useState } from 'react';

import { buildDecisionViewRoute, type DecisionSearch } from '../_lib/decision-search-params';
import { parseMyRate } from '../_model/present-distribution';
import { useDecisionRoute } from './evidence-view';

/**
 * 이 눈금은 사정률(분모 예정가격)이고 레일 손잡이는 투찰률(분모 기초금액)이다. 마감 전에는 예정가격이
 * 추첨되지 않아 두 축 사이 변환에 필요한 입력 자체가 없으므로 손잡이 값을 여기 꽂지 않는다(PDR-0004).
 *
 * **기본값을 두지 않는다.** 최빈 칸이나 하한율을 미리 넣으면 그것이 추천값으로 읽힌다(AGENTS 8).
 */
export function MyRateInput({
  auctionId,
  search
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
}) {
  const [draft, setDraft] = useState(search.myRate ?? '');
  // 이 입력은 분포 본문에 산다. 근거 탭이 서버 왕복 없이 바뀜므로 주소도 지금 보는 본문으로 고쳐 만든다.
  const route = useDecisionRoute();
  const parsed = parseMyRate(draft);
  const isBlank = draft.trim() === '';
  // 잘못된 입력은 링크를 만들지 않는다. URL에 넣고 모델이 버리게 하면 주소가 조용히 오염된다.
  const target = parsed === null ? null : { ...search, myRate: draft.trim() };

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <label className='text-[13px] font-semibold whitespace-nowrap text-muted-foreground' htmlFor='my-rate'>
        내 값(사정률)
      </label>
      <input
        id='my-rate'
        name='myRate'
        inputMode='decimal'
        autoComplete='off'
        placeholder='예 90.030'
        value={draft}
        aria-describedby='my-rate-axis'
        aria-invalid={!isBlank && parsed === null}
        onChange={(event) => setDraft(event.target.value)}
        className='h-9 w-32 rounded-md bg-foreground/5 px-3 text-[15px] font-semibold tabular-nums'
      />
      {target === null ? (
        <span className='text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>
          {isBlank ? '값을 넣으면 사다리에 줄이 그어집니다' : '사정률은 소수 셋째 자리까지입니다'}
        </span>
      ) : (
        <Link
          href={route(buildDecisionViewRoute(auctionId, target, search.view))}
          className='inline-flex h-9 items-center rounded-md bg-primary/10 px-3 text-[15px] font-semibold whitespace-nowrap text-primary'
        >
          사다리에 놓기
        </Link>
      )}
      {search.myRate === null ? null : (
        <Link
          href={route(buildDecisionViewRoute(auctionId, { ...search, myRate: null }, search.view))}
          className='inline-flex h-9 items-center rounded-md px-3 text-[15px] font-medium whitespace-nowrap text-muted-foreground'
        >
          지우기
        </Link>
      )}
      <span id='my-rate-axis' className='text-[13px] font-medium text-muted-foreground'>
        이 눈금은 사정률입니다. NeaT에 넣는 투찰률과 분모가 다릅니다.
      </span>
    </div>
  );
}
