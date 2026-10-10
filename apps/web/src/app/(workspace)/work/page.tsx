/** @module 책임: 오늘 투찰 route에서 주소의 품목 조건을 읽고 서버 조회를 Suspense 안에서 조립한다. */
import { Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { createLoader } from 'nuqs/server';

import { getMyBidBoardFromServer, getMyRegionPreferenceFromServer, listMyBusinessesFromServer } from '@/api/account/server';
import { loadWorkPage } from './_lib/load-work-page';
import { workSearchParsers } from './_lib/work-search';
import { WorkScreen } from './_widgets/work-screen';
import { WorkScreenSkeleton } from './_widgets/work-screen-skeleton';

type Props = PageProps<'/work'>;
const loadSearch = createLoader(workSearchParsers);

/** 목록이 걸러진 범위를 말하는 요약 줄의 재료다. 둘 다 요청 범위 memo 조회라 오늘 화면과 같은 답을 쓴다. */
async function readConditions() {
  const [preference, businesses] = await Promise.all([getMyRegionPreferenceFromServer(), listMyBusinessesFromServer()]);
  return {
    areas: preference.kind === 'preference' ? preference.response.preference.areas : null,
    businessCount: businesses.kind === 'businesses' ? businesses.response.businesses.length : null
  };
}

async function WorkLoader({ searchParams }: Props) {
  const search = await loadSearch(searchParams);
  const view = await loadWorkPage(search, { readBoard: getMyBidBoardFromServer, readConditions });
  return (
    <NuqsAdapter>
      <WorkScreen view={view} />
    </NuqsAdapter>
  );
}

export default function WorkPage(props: Props) {
  return (
    <Suspense fallback={<WorkScreenSkeleton />}>
      <WorkLoader {...props} />
    </Suspense>
  );
}
