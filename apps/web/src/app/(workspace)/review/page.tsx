/** @module 책임: 복기 route에서 주소의 달을 읽고 서버 조회를 Suspense 안에서 조립한다. */
import { Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { createLoader } from 'nuqs/server';

import { getMyBidReviewFromServer } from '@/api/account/server';
import { presentReview } from './_features/review-board/model/present-review';
import { reviewSearchParsers } from './_lib/review-search';
import { ReviewScreen } from './_widgets/review-screen';
import { ReviewScreenSkeleton } from './_widgets/review-screen-skeleton';

type Props = PageProps<'/review'>;
const loadSearch = createLoader(reviewSearchParsers);

async function ReviewLoader({ searchParams }: Props) {
  const search = await loadSearch(searchParams);
  const read = await getMyBidReviewFromServer(search.month === null ? {} : { month: search.month });
  const view = read.kind === 'forbidden' ? { kind: 'forbidden' as const } : presentReview(read.response);
  return (
    <NuqsAdapter>
      <ReviewScreen view={view} />
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
