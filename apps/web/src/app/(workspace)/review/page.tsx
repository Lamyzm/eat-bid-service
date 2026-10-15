/** @module 책임: 복기 route에서 주소의 달을 읽고 서버 조회를 Suspense 안에서 조립한다. */
import { Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { createLoader } from 'nuqs/server';

import { systemClock } from '@eatbid/domain';

import { getMyBidReviewFromServer } from '@/api/account/server';
import { findFloorLinesFromServer, findMyFloorRegionFromServer } from '@/api/floor-lines/server';
import { loadMonthEntry } from '@/entities/floor-line/floor-entry';
import { FloorEntryLine } from '@/entities/floor-line/floor-entry-line';
import { presentReview } from './_features/review-board/model/present-review';
import { reviewSearchParsers } from './_lib/review-search';
import { ReviewScreen } from './_widgets/review-screen';
import { ReviewScreenSkeleton } from './_widgets/review-screen-skeleton';

type Props = PageProps<'/review'>;
const loadSearch = createLoader(reviewSearchParsers);

/** 고른 달의 하한선 자리 입구 줄이다(EAT-356). 내 업체 주 공고지역의 그 달 하한선을 따로 읽는다. */
async function ReviewFloorEntry({ month }: { readonly month: string }) {
  const view = await loadMonthEntry(systemClock.now().toZonedDateTimeISO('Asia/Seoul').toPlainDate(), month, {
    myRegion: findMyFloorRegionFromServer,
    lines: findFloorLinesFromServer
  });
  return view === null ? null : <FloorEntryLine view={view} />;
}

async function ReviewLoader({ searchParams }: Props) {
  const search = await loadSearch(searchParams);
  const read = await getMyBidReviewFromServer(search.month === null ? {} : { month: search.month });
  const view = read.kind === 'forbidden' ? { kind: 'forbidden' as const } : presentReview(read.response);
  const month = read.kind === 'forbidden' ? null : (read.response.selected?.month ?? null);
  return (
    <NuqsAdapter>
      <ReviewScreen
        view={view}
        floorEntry={
          month === null ? null : (
            <Suspense fallback={null}>
              <ReviewFloorEntry month={month} />
            </Suspense>
          )
        }
      />
    </NuqsAdapter>
  );
}

export default function ReviewPage(props: Props) {
  return (
    <Suspense fallback={<ReviewScreenSkeleton />}>
      <ReviewLoader {...props} />
    </Suspense>
  );
}
