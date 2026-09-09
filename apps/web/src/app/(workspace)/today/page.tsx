/** @module 책임: 오늘 RSC route에서 searchParams 접근을 Suspense 안 loader로 격리하고 열린 공고 목록 계약 조회 결과를 화면에 넘긴다. */
import { systemClock } from '@eatbid/domain';
import { listOpenAuctionsFromServer } from '@/api/auctions/server';
import { createLoader } from 'nuqs/server';
import { Suspense } from 'react';

import { todaySearchParsers } from './_lib/today-search-params';
import { loadTodayPage } from './_model/load-today-page';
import { TodayScreen } from './_ui/today-screen';
import { TodayScreenSkeleton } from './_ui/today-screen-skeleton';

type TodayPageSearchParams = PageProps<'/today'>['searchParams'];

const loadTodaySearch = createLoader(todaySearchParsers);

async function TodayLoader({ searchParams }: { readonly searchParams: TodayPageSearchParams }) {
  const search = await loadTodaySearch(searchParams);
  const data = await loadTodayPage(search, {
    listOpenAuctions: listOpenAuctionsFromServer,
    // D-day는 요청 시각의 함수다. 컴포넌트 안에서 `Date`나 `Temporal.Now`를 부르지 않고 여기서 한 번 만든다.
    now: () => systemClock.now().toString()
  });
  return <TodayScreen data={data} />;
}

// searchParams를 page 최상위에서 await하면 static shell이 사라진다(ADR 0028). promise를 Suspense 안 loader에
// 넘겨 shell은 prerender하고 목록만 request 시점에 streaming한다. fallback은 loading.tsx와 같은 skeleton이다.
export default function TodayPage({ searchParams }: PageProps<'/today'>) {
  return (
    <Suspense fallback={<TodayScreenSkeleton />}>
      <TodayLoader searchParams={searchParams} />
    </Suspense>
  );
}
