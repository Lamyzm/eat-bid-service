/** @module 책임: 조달 기능의 use case와 HTTP controller를 주입 토큰에 연결하는 Nest 조립만 담당한다. */
import { Module } from "@nestjs/common";
import type { AuctionReader } from "./application/auction-reader";
import type { AuctionRosterReader } from "./application/auction-roster-reader";
import { CachedAuctionRosterReader } from "./infrastructure/caching/cached-auction-roster-reader";
import { GetAuctionRoster } from "./application/get-auction-roster";
import { AuctionRosterController } from "./presentation/http/auction-roster.controller";
import { FindAuction } from "./application/find-auction";
import { FindAnalysisTimeSeries } from "./application/find-analysis-time-series";
import { FindWinRateDistribution } from "./application/find-win-rate-distribution";
import type { AnalysisTimeSeriesReader } from "./application/analysis-time-series-reader";
import { ListOpenAuctions } from "./application/list-open-auctions";
import type { OpenAuctionSummaryReader } from "./application/open-auction-summary-reader";
import { SummarizeOpenAuctions } from "./application/summarize-open-auctions";
import { ListOrganizationAuctionAttempts } from "./application/list-organization-auction-attempts";
import type { EligibilityAreaReader } from "./application/eligibility-area-reader";
import { ListEligibilityAreas, PreviewRegionCoverage } from "./application/preview-region-coverage";
import { EligibilityAreaController } from "./presentation/http/eligibility-area.controller";
import type { OpenAuctionReader } from "./application/open-auction-reader";
import type { OrganizationAttemptReader } from "./application/organization-attempt-reader";
import type { WinRateDistributionReader } from "./application/win-rate-distribution-reader";
import { AuctionController } from "./presentation/http/auction.controller";
import { MyBidObservationsController } from "./presentation/http/my-bid-observations.controller";
import { OrganizationController } from "./presentation/http/organization.controller";
import { AnalysisController } from "./presentation/http/analysis.controller";
import { WinRateDistributionController } from "./presentation/http/win-rate-distribution.controller";
import { FindMyBidObservations } from "./application/find-my-bid-observations";
import type { OwnBidReader } from "./application/own-bid-reader";
import type { RegisteredBusinessReader } from "../account/application/registered-business-reader";
import type { UnitOfWork } from "../../platform/database/unit-of-work";
import {
  ANALYSIS_TIME_SERIES_READER,
  AUCTION_READER,
  AUCTION_ROSTER_READER,
  ELIGIBILITY_AREA_READER,
  OPEN_AUCTION_READER,
  OPEN_AUCTION_SUMMARY_READER,
  ORGANIZATION_ATTEMPT_READER,
  OWN_BID_READER,
  READ_SNAPSHOT,
  REGISTERED_BUSINESS_READER,
  WIN_RATE_DISTRIBUTION_READER,
} from "../../platform/database/database.tokens";
import type { Clock } from "@eatbid/domain";
import { CLOCK } from "../../platform/clock/clock.module";

/** 캐시로 감싼 명단 port의 모듈 내부 토큰이다. 내보내지 않아 다른 모듈이 캐시 여부에 기대지 못한다. */
const CACHED_AUCTION_ROSTER_READER = Symbol("CACHED_AUCTION_ROSTER_READER");

/**
 * 회차를 고정한 명단은 같은 값을 여러 사람이 반복해서 연다. 그 재사용을 use case가 아니라 port를 감싼
 * infrastructure 장식자가 맡고 모듈이 배선하는 이유는, 저장소를 실제로 읽는지가 조회 port의 성질이고
 * use case는 port 인터페이스만 알아야 해서다(ADR 0045 결정 4). provider가 하나뿐이라 이 재사용은 pod
 * 하나의 수명 동안 유지된다.
 */
const cachedAuctionRosterReaderProvider = {
  provide: CACHED_AUCTION_ROSTER_READER,
  inject: [AUCTION_ROSTER_READER, CLOCK],
  useFactory: (reader: AuctionRosterReader, clock: Clock): AuctionRosterReader =>
    new CachedAuctionRosterReader(reader, clock),
};

const getAuctionRosterProvider = {
  provide: GetAuctionRoster,
  inject: [CACHED_AUCTION_ROSTER_READER],
  useFactory: (reader: AuctionRosterReader) => new GetAuctionRoster(reader),
};

const findAuctionProvider = {
  provide: FindAuction,
  inject: [AUCTION_READER],
  useFactory: (reader: AuctionReader) => new FindAuction(reader),
};

// 개찰 필터의 기준 시각, 분포의 기본 기간, 열린 공고의 "열림" 판정은 현재 시각의 함수라 세 use case가
// clock을 요구한다. `Temporal.Now` 직접 호출은 금지이며 주입된 clock만 쓴다(AGENTS 17).
const listOrganizationAuctionAttemptsProvider = {
  provide: ListOrganizationAuctionAttempts,
  inject: [ORGANIZATION_ATTEMPT_READER, CLOCK],
  useFactory: (reader: OrganizationAttemptReader, clock: Clock) =>
    new ListOrganizationAuctionAttempts(reader, clock),
};

const findWinRateDistributionProvider = {
  provide: FindWinRateDistribution,
  inject: [WIN_RATE_DISTRIBUTION_READER, CLOCK],
  useFactory: (reader: WinRateDistributionReader, clock: Clock) => new FindWinRateDistribution(reader, clock),
};

// 스냅샷의 발급 시각과 유효 기간이 현재 시각의 함수라 이 use case도 clock을 받는다(AGENTS 17).
const findAnalysisTimeSeriesProvider = {
  provide: FindAnalysisTimeSeries,
  inject: [ANALYSIS_TIME_SERIES_READER, CLOCK],
  useFactory: (reader: AnalysisTimeSeriesReader, clock: Clock) => new FindAnalysisTimeSeries(reader, clock),
};

const listEligibilityAreasProvider = {
  provide: ListEligibilityAreas,
  inject: [ELIGIBILITY_AREA_READER],
  useFactory: (reader: EligibilityAreaReader) => new ListEligibilityAreas(reader),
};

// 미리보기의 "오늘"과 "지난 90일"은 둘 다 현재 시각의 함수라 창의 양끝을 use case가 주입된 clock으로
// 확정한다. SQL에서 `now()`를 부르면 세 숫자가 서로 다른 순간을 본다(AGENTS 17).
const previewRegionCoverageProvider = {
  provide: PreviewRegionCoverage,
  inject: [ELIGIBILITY_AREA_READER, CLOCK],
  useFactory: (reader: EligibilityAreaReader, clock: Clock) => new PreviewRegionCoverage(reader, clock),
};

const listOpenAuctionsProvider = {
  provide: ListOpenAuctions,
  inject: [OPEN_AUCTION_READER, CLOCK],
  useFactory: (reader: OpenAuctionReader, clock: Clock) => new ListOpenAuctions(reader, clock),
};

const summarizeOpenAuctionsProvider = {
  provide: SummarizeOpenAuctions,
  inject: [OPEN_AUCTION_SUMMARY_READER, CLOCK],
  useFactory: (reader: OpenAuctionSummaryReader, clock: Clock) => new SummarizeOpenAuctions(reader, clock),
};

// 등록 사업자 소유 판정과 mart 조회가 같은 스냅샷을 읽어야 하므로 use case가 읽기 경계도 함께 받는다.
const findMyBidObservationsProvider = {
  provide: FindMyBidObservations,
  inject: [READ_SNAPSHOT, REGISTERED_BUSINESS_READER, OWN_BID_READER],
  useFactory: (snapshot: UnitOfWork, businesses: RegisteredBusinessReader, reader: OwnBidReader) =>
    new FindMyBidObservations(snapshot, businesses, reader),
};

@Module({
  controllers: [
    AnalysisController,
    AuctionController,
    AuctionRosterController,
    EligibilityAreaController,
    MyBidObservationsController,
    OrganizationController,
    WinRateDistributionController,
  ],
  providers: [
    cachedAuctionRosterReaderProvider,
    getAuctionRosterProvider,
    findAuctionProvider,
    listOrganizationAuctionAttemptsProvider,
    findWinRateDistributionProvider,
    findAnalysisTimeSeriesProvider,
    listOpenAuctionsProvider,
    summarizeOpenAuctionsProvider,
    listEligibilityAreasProvider,
    previewRegionCoverageProvider,
    findMyBidObservationsProvider,
  ],
})
export class ProcurementModule {}
