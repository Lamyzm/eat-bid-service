/** @module 책임: 새 상세 개발 경로에서 공고 조회와 공통 조건을 Suspense 안에서 조립한다. 최종 전환 경로는 상세 교체 계획이 소유한다. */
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { createLoader } from 'nuqs/server';
import { systemClock } from '@eatbid/domain';
import { getAuctionFromServer, parseAuctionId } from '@/api/auctions/server';
import { findAnalysisTimeSeriesFromServer } from '@/api/analysis/server';
import { analysisSearchParsers } from './_lib/analysis-search';
import { loadAnalysisPage } from './_lib/load-analysis-page';
import { AnalysisScreen } from './_widgets/analysis-screen';
import { AnalysisScreenSkeleton } from './_widgets/analysis-screen-skeleton';

type Props = PageProps<'/auctions/[auctionId]/analysis'>;
const loadSearch = createLoader(analysisSearchParsers);
async function AnalysisLoader({ params, searchParams }: Props) {
  const [{ auctionId }, search] = await Promise.all([params, loadSearch(searchParams)]);
  const data = await loadAnalysisPage(auctionId, search.analysis, {
    parseId: parseAuctionId,
    readAuction: getAuctionFromServer,
    readTimeSeries: findAnalysisTimeSeriesFromServer,
    now: () => systemClock.now().toString()
  });
  if (!data) notFound();
  return (
    <NuqsAdapter>
      <AnalysisScreen data={data} />
    </NuqsAdapter>
  );
}
export default function AnalysisPage(props: Props) {
  return (
    <Suspense fallback={<AnalysisScreenSkeleton />}>
      <AnalysisLoader {...props} />
    </Suspense>
  );
}
