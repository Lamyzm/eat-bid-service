/** @module 책임: 하한선 자리 route에서 주소·마지막 지역 쿠키·오늘 날짜를 읽어 조회를 주입하고 Suspense 안에서 화면을 조립한다. */
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { createLoader } from 'nuqs/server';
import { systemClock } from '@eatbid/domain';

import { findFloorLineRegionsFromServer, findFloorLinesFromServer, findMyFloorBidsFromServer } from '@/api/floor-lines/server';
import { loadFloorView } from './_features/floor-board/model/load-floor-view';
import { FLOOR_REGION_COOKIE, floorSearchParsers } from './_lib/floor-search';
import { FloorScreen } from './_widgets/floor-screen';
import { FloorScreenSkeleton } from './_widgets/floor-screen-skeleton';

type Props = PageProps<'/floor'>;
const loadSearch = createLoader(floorSearchParsers);

async function FloorLoader({ searchParams }: Props) {
  const search = await loadSearch(searchParams);
  const view = await loadFloorView(
    {
      search,
      rememberedRegion: (await cookies()).get(FLOOR_REGION_COOKIE)?.value,
      // 기간은 요청 시각의 함수다. 컴포넌트 안에서 시계를 부르지 않고 여기서 한 번 읽는다.
      today: systemClock.now().toZonedDateTimeISO('Asia/Seoul').toPlainDate()
    },
    { regions: findFloorLineRegionsFromServer, lines: findFloorLinesFromServer, mine: findMyFloorBidsFromServer }
  );
  return (
    <NuqsAdapter>
      <FloorScreen view={view} />
    </NuqsAdapter>
  );
}

export default function FloorPage(props: Props) {
  return (
    <Suspense fallback={<FloorScreenSkeleton />}>
      <FloorLoader {...props} />
    </Suspense>
  );
}
