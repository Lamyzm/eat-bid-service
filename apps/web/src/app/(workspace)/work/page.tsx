/** @module 책임: 오늘 투찰 route에서 주소의 품목 조건을 읽고 서버 조회를 Suspense 안에서 조립한다. */
import { Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { createLoader } from 'nuqs/server';

import { systemClock } from '@eatbid/domain';

import { getMyBidBoardFromServer, getMyRegionPreferenceFromServer, listMyBusinessesFromServer } from '@/api/account/server';
import { findFloorLinesFromServer, findMyFloorRegionFromServer } from '@/api/floor-lines/server';
import { loadRecentEntry } from '@/entities/floor-line/floor-entry';
import { FloorEntryLine } from '@/entities/floor-line/floor-entry-line';
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

/** 하한선 자리 입구 줄이다(EAT-356). 내 업체 주 공고지역과 그 최근 1년 하한선을 따로 읽어, 늦거나 실패해도 목록을 막지 않는다. */
async function WorkFloorEntry() {
  const view = await loadRecentEntry(systemClock.now().toZonedDateTimeISO('Asia/Seoul').toPlainDate(), {
    myRegion: findMyFloorRegionFromServer,
    lines: findFloorLinesFromServer
  });
  return view === null ? null : <FloorEntryLine view={view} />;
}

async function WorkLoader({ searchParams }: Props) {
  const search = await loadSearch(searchParams);
  const view = await loadWorkPage(search, { readBoard: getMyBidBoardFromServer, readConditions });
  return (
    <NuqsAdapter>
      <WorkScreen
        view={view}
        floorEntry={
          <Suspense fallback={null}>
            <WorkFloorEntry />
          </Suspense>
        }
      />
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
