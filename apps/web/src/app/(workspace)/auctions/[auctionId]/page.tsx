/** @module 책임: 새 상세 개발 경로에서 공고 조회와 공통 조건을 Suspense 안에서 조립한다. 최종 전환 경로는 상세 교체 계획이 소유한다. */
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { createLoader } from 'nuqs/server';
import { systemClock } from '@eatbid/domain';
import {
  getAuctionBidPositionFromServer,
  getAuctionFromServer,
  parseAuctionId
} from '@/api/auctions/server';
import {
  findAnalysisDistributionFromServer,
  findAnalysisTimeSeriesFromServer
} from '@/api/analysis/server';
import { findFloorLinesFromServer } from '@/api/floor-lines/server';
import { loadAuctionRegionEntry } from '@/entities/floor-line/floor-entry';
import { FloorEntryLine } from '@/entities/floor-line/floor-entry-line';
import { analysisSearchParsers } from './_lib/analysis-search';
import { loadAnalysisPage } from './_lib/load-analysis-page';
import { AnalysisScreen } from './_widgets/analysis-screen';
import { AnalysisScreenSkeleton } from './_widgets/analysis-screen-skeleton';

type Props = PageProps<'/auctions/[auctionId]'>;
const loadSearch = createLoader(analysisSearchParsers);

/** 이 공고 지역의 하한선 자리 입구 줄이다(EAT-356). 그 지역 최근 1년 하한선을 따로 읽어 분석을 막지 않는다. */
async function AuctionFloorEntry({ region }: { readonly region: { readonly id: string; readonly label: string | null } }) {
  const view = await loadAuctionRegionEntry(systemClock.now().toZonedDateTimeISO('Asia/Seoul').toPlainDate(), region, {
    lines: findFloorLinesFromServer
  });
  return view === null ? null : <FloorEntryLine view={view} />;
}
async function AnalysisLoader({ params, searchParams }: Props) {
  const [{ auctionId }, search] = await Promise.all([params, loadSearch(searchParams)]);
  const data = await loadAnalysisPage(auctionId, search.analysis, {
    parseId: parseAuctionId,
    readAuction: getAuctionFromServer,
    readTimeSeries: findAnalysisTimeSeriesFromServer,
    readDistribution: findAnalysisDistributionFromServer,
    readBidPosition: getAuctionBidPositionFromServer,
    now: () => systemClock.now().toString()
  });
  if (!data) notFound();
  return (
    <NuqsAdapter>
      <AnalysisScreen
        data={data}
        floorEntry={
          data.floorRegion === null ? null : (
            <Suspense fallback={null}>
              <AuctionFloorEntry region={data.floorRegion} />
            </Suspense>
          )
        }
      />
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
