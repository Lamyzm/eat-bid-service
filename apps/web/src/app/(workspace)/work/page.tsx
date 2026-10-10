/** @module 책임: 오늘 투찰 route에서 주소의 품목 조건을 읽고 서버 조회를 Suspense 안에서 조립한다. */
import { Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { createLoader } from 'nuqs/server';

import { getMyBidBoardFromServer } from '@/api/account/server';
import { loadWorkPage } from './_lib/load-work-page';
import { workSearchParsers } from './_lib/work-search';
import { WorkScreen } from './_widgets/work-screen';
import { WorkScreenSkeleton } from './_widgets/work-screen-skeleton';

type Props = PageProps<'/work'>;
const loadSearch = createLoader(workSearchParsers);

async function WorkLoader({ searchParams }: Props) {
  const search = await loadSearch(searchParams);
  const view = await loadWorkPage(search, { readBoard: getMyBidBoardFromServer });
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
