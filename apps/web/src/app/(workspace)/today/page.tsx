/** @module 책임: 오늘 RSC route에서 searchParams 접근을 Suspense 안 loader로 격리하고 열린 공고 목록 계약 조회 결과를 화면에 넘긴다. */
import { systemClock } from '@eatbid/domain';
import { getMyRegionPreferenceFromServer } from '@/api/account/server';
import { listOpenAuctionsFromServer, summarizeOpenAuctionsFromServer } from '@/api/auctions/server';
import { createLoader } from 'nuqs/server';
import { Suspense } from 'react';

import { todaySearchParsers } from './_lib/today-search-params';
import { loadTodayPage } from './_model/load-today-page';
import { TodayScreen } from './_ui/today-screen';
import { TodayScreenSkeleton } from './_ui/today-screen-skeleton';

// route 이름은 `app/` 폴더가 소유하고 이 리터럴은 생성된 route 목록을 참조할 뿐이다. 파일 안에서 한 번만
// 적어 이름이 바뀔 때 고칠 자리도 하나로 둔다.
type TodayPageProps = PageProps<'/today'>;

const loadTodaySearch = createLoader(todaySearchParsers);

async function TodayLoader({ searchParams }: { readonly searchParams: TodayPageProps['searchParams'] }) {
  const search = await loadTodaySearch(searchParams);
  // 지역 설정은 목록을 부를지 말지를 정하므로 조회보다 먼저 읽는다. 읽지 못한 것과 확인하지 않은 것은
  // 사용자가 할 일이 다르므로 loader가 두 상태를 구분해 넘긴다.
  const preference = await getMyRegionPreferenceFromServer();
  const data = await loadTodayPage(search, {
    listOpenAuctions: listOpenAuctionsFromServer,
    summarizeOpenAuctions: summarizeOpenAuctionsFromServer,
    regionPreference: preference.kind === 'preference' ? preference.response.preference : undefined,
    // D-day는 요청 시각의 함수다. 컴포넌트 안에서 `Date`나 `Temporal.Now`를 부르지 않고 여기서 한 번 만든다.
    now: () => systemClock.now().toString()
  });
  return <TodayScreen data={data} />;
}

// searchParams를 page 최상위에서 await하면 static shell이 사라진다(ADR 0028). promise를 Suspense 안 loader에
// 넘겨 shell은 prerender하고 목록만 request 시점에 streaming한다. fallback은 loading.tsx와 같은 skeleton이다.
export default function TodayPage({ searchParams }: TodayPageProps) {
  return (
    <Suspense fallback={<TodayScreenSkeleton />}>
      <TodayLoader searchParams={searchParams} />
    </Suspense>
  );
}
