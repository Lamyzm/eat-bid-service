/** @module 책임: 넣을 공고 route에서 공고 한 장과 등록 사업장 조회를 Suspense 안에서 조립한다. */
import { Suspense } from 'react';

import { getMyBidBoardFromServer, listMyBusinessesFromServer } from '@/api/account/server';
import { loadWorkPage } from './load-work-page';
import { WorkScreen } from './_components/work-screen';
import { WorkScreenSkeleton } from './_components/work-screen-skeleton';

async function WorkLoader() {
  const view = await loadWorkPage({ readBoard: () => getMyBidBoardFromServer({}), readBusinesses: listMyBusinessesFromServer });
  return <WorkScreen view={view} />;
}

export default function WorkPage() {
  return (
    <Suspense fallback={<WorkScreenSkeleton />}>
      <WorkLoader />
    </Suspense>
  );
}
