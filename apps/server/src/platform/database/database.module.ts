/** @module 책임: PostgreSQL 연결 수명주기를 감추고 목적별 조회·트랜잭션 port만 주입 가능하게 만든다. */
import { DynamicModule, Global, Module, type Provider } from "@nestjs/common";
import type { AccountRepository } from "../../modules/account/application/account-repository";
import { DrizzleAccountRepository } from "../../modules/account/infrastructure/drizzle/drizzle-account-repository";
import { DrizzleRegisteredBusinessReader } from "../../modules/account/infrastructure/drizzle/drizzle-registered-business-reader";
import type { RegionPreferenceRepository } from "../../modules/account/application/region-preference-repository";
import { DrizzleRegionPreferenceRepository } from "../../modules/account/infrastructure/drizzle/drizzle-region-preference-repository";
import type { FilterCombinationRepository } from "../../modules/account/application/filter-combination-repository";
import { DrizzleFilterCombinationRepository } from "../../modules/account/infrastructure/drizzle/drizzle-filter-combination-repository";
import type { OpenAuctionFilterCountsReader } from "../../modules/procurement/application/count-open-auctions-for-filters";
import { DrizzleOpenAuctionFilterCountsReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-open-auction-filter-counts-reader";
import type { EligibilityAreaReader } from "../../modules/procurement/application/eligibility-area-reader";
import { DrizzleEligibilityAreaReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-eligibility-area-reader";
import { DrizzleOwnBidReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-own-bid-reader";
import type { AuctionReader } from "../../modules/procurement/application/auction-reader";
import type { AuctionRosterReader } from "../../modules/procurement/application/auction-roster-reader";
import { DrizzleAuctionRosterReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-auction-roster-reader";
import type { OpenAuctionReader } from "../../modules/procurement/application/open-auction-reader";
import type { OpenAuctionSummaryReader } from "../../modules/procurement/application/open-auction-summary-reader";
import type { OrganizationAttemptReader } from "../../modules/procurement/application/organization-attempt-reader";
import type { AnalysisTimeSeriesReader } from "../../modules/procurement/application/analysis-time-series-reader";
import type { WinRateDistributionReader } from "../../modules/procurement/application/win-rate-distribution-reader";
import type { CodeReader } from "../../modules/reference/application/code-reader";
import { DrizzleAuctionReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-auction-reader";
import { DrizzleOpenAuctionReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-open-auction-reader";
import { DrizzleOpenAuctionSummaryReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-open-auction-summary-reader";
import { DrizzleOrganizationAttemptReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-organization-attempt-reader";
import { DrizzleAnalysisTimeSeriesReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-analysis-time-series-reader";
import { DrizzleWinRateDistributionReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-win-rate-distribution-reader";
import { DrizzleCodeReader } from "../../modules/reference/infrastructure/drizzle/drizzle-code-reader";
import type { Environment } from "../config/environment";
import type { DatabaseReadiness } from "../health/readiness-state";
import { createDatabaseReadiness } from "./database-readiness";
import { createManagedDatabase, ManagedDatabase } from "./managed-database";
import {
  ACCOUNT_REPOSITORY,
  AUCTION_READER,
  AUCTION_ROSTER_READER,
  CODE_READER,
  DATABASE_CONNECTION,
  DATABASE_READINESS,
  ELIGIBILITY_AREA_READER,
  OPEN_AUCTION_READER,
  FILTER_COMBINATION_REPOSITORY,
  OPEN_AUCTION_FILTER_COUNTS_READER,
  OPEN_AUCTION_SUMMARY_READER,
  ORGANIZATION_ATTEMPT_READER,
  OWN_BID_READER,
  READ_SNAPSHOT,
  REGION_PREFERENCE_REPOSITORY,
  REGISTERED_BUSINESS_READER,
  UNIT_OF_WORK,
  ANALYSIS_TIME_SERIES_READER,
  WIN_RATE_DISTRIBUTION_READER,
} from "./database.tokens";
import { createUnitOfWork, type UnitOfWork } from "./unit-of-work";

export interface DatabaseModuleOverrides {
  /** bootstrap이 인증 전송보다 먼저 만든 연결이다. 주지 않으면 모듈이 자기 풀을 연다. */
  readonly connection?: ManagedDatabase;
  readonly readiness?: DatabaseReadiness;
  readonly accountRepository?: AccountRepository;
  readonly regionPreferenceRepository?: RegionPreferenceRepository;
  readonly filterCombinationRepository?: FilterCombinationRepository;
  readonly openAuctionFilterCountsReader?: OpenAuctionFilterCountsReader;
  readonly eligibilityAreaReader?: EligibilityAreaReader;
  readonly auctionReader?: AuctionReader;
  readonly auctionRosterReader?: AuctionRosterReader;
  readonly openAuctionReader?: OpenAuctionReader;
  readonly openAuctionSummaryReader?: OpenAuctionSummaryReader;
  readonly organizationAttemptReader?: OrganizationAttemptReader;
  readonly winRateDistributionReader?: WinRateDistributionReader;
  readonly analysisTimeSeriesReader?: AnalysisTimeSeriesReader;
  readonly codeReader?: CodeReader;
}

@Global()
@Module({})
export class DatabaseModule {
  /** DB client 수명주기는 감추고 readiness, 트랜잭션, 조회 포트처럼 목적이 제한된 권한만 내보낸다. */
  static forRuntime(
    environment: Environment,
    overrides: DatabaseModuleOverrides = {},
  ): DynamicModule {
    const providers: Provider[] = [
      {
        provide: DATABASE_CONNECTION,
        useFactory: () => overrides.connection ?? createManagedDatabase(environment.databaseUrl),
      },
      {
        provide: DATABASE_READINESS,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): DatabaseReadiness =>
          overrides.readiness ?? createDatabaseReadiness(connection.database),
      },
      {
        provide: UNIT_OF_WORK,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): UnitOfWork => createUnitOfWork({
          transaction: (work) => connection.database.transaction((transaction) => work(transaction)),
        }),
      },
      {
        /**
         * 개인 조회 하나가 권한 판정과 사실 조회를 같은 시점에서 읽게 하는 경계다. `repeatable read`인
         * 이유는 그 둘 사이에 커밋된 변경이 보이면 권한과 자료가 어긋난 응답이 만들어지기 때문이고,
         * `read only`인 이유는 읽기 경로가 쓰기 권한을 갖지 않아야 하기 때문이다.
         */
        provide: READ_SNAPSHOT,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): UnitOfWork => createUnitOfWork({
          transaction: (work) => connection.database.transaction(
            (transaction) => work(transaction),
            { isolationLevel: "repeatable read", accessMode: "read only" },
          ),
        }),
      },
      {
        // 스냅샷 handle만 받아 읽으므로 연결을 직접 들지 않는다.
        provide: REGISTERED_BUSINESS_READER,
        useValue: new DrizzleRegisteredBusinessReader(),
      },
      {
        provide: OWN_BID_READER,
        useValue: new DrizzleOwnBidReader(),
      },
      {
        provide: AUCTION_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): AuctionReader =>
          overrides.auctionReader ?? new DrizzleAuctionReader(connection.database),
      },
      {
        provide: OPEN_AUCTION_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): OpenAuctionReader =>
          overrides.openAuctionReader ?? new DrizzleOpenAuctionReader(connection.database),
      },
      {
        provide: OPEN_AUCTION_SUMMARY_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): OpenAuctionSummaryReader =>
          overrides.openAuctionSummaryReader ?? new DrizzleOpenAuctionSummaryReader(connection.database),
      },
      {
        provide: AUCTION_ROSTER_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): AuctionRosterReader =>
          overrides.auctionRosterReader ?? new DrizzleAuctionRosterReader(connection.database),
      },
      {
        provide: ORGANIZATION_ATTEMPT_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): OrganizationAttemptReader =>
          overrides.organizationAttemptReader ?? new DrizzleOrganizationAttemptReader(connection.database),
      },
      {
        provide: WIN_RATE_DISTRIBUTION_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): WinRateDistributionReader =>
          overrides.winRateDistributionReader ?? new DrizzleWinRateDistributionReader(connection.database),
      },
      {
        provide: ANALYSIS_TIME_SERIES_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): AnalysisTimeSeriesReader =>
          overrides.analysisTimeSeriesReader ?? new DrizzleAnalysisTimeSeriesReader(connection.database),
      },
      {
        provide: CODE_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): CodeReader =>
          overrides.codeReader ?? new DrizzleCodeReader(connection.database),
      },
      {
        provide: ACCOUNT_REPOSITORY,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): AccountRepository =>
          overrides.accountRepository ?? new DrizzleAccountRepository(connection.database),
      },
      {
        provide: REGION_PREFERENCE_REPOSITORY,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): RegionPreferenceRepository =>
          overrides.regionPreferenceRepository ?? new DrizzleRegionPreferenceRepository(connection.database),
      },
      {
        provide: ELIGIBILITY_AREA_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): EligibilityAreaReader =>
          overrides.eligibilityAreaReader ?? new DrizzleEligibilityAreaReader(connection.database),
      },
      {
        provide: FILTER_COMBINATION_REPOSITORY,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): FilterCombinationRepository =>
          overrides.filterCombinationRepository ?? new DrizzleFilterCombinationRepository(connection.database),
      },
      {
        provide: OPEN_AUCTION_FILTER_COUNTS_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): OpenAuctionFilterCountsReader =>
          overrides.openAuctionFilterCountsReader ?? new DrizzleOpenAuctionFilterCountsReader(connection.database),
      },
    ];
    return {
      global: true,
      module: DatabaseModule,
      providers,
      exports: [
        ACCOUNT_REPOSITORY,
        REGION_PREFERENCE_REPOSITORY,
        FILTER_COMBINATION_REPOSITORY,
        OPEN_AUCTION_FILTER_COUNTS_READER,
        ELIGIBILITY_AREA_READER,
        DATABASE_READINESS,
        UNIT_OF_WORK,
        READ_SNAPSHOT,
        REGISTERED_BUSINESS_READER,
        OWN_BID_READER,
        AUCTION_READER,
        AUCTION_ROSTER_READER,
        OPEN_AUCTION_READER,
        OPEN_AUCTION_SUMMARY_READER,
        ORGANIZATION_ATTEMPT_READER,
        WIN_RATE_DISTRIBUTION_READER,
        ANALYSIS_TIME_SERIES_READER,
        CODE_READER,
      ],
    };
  }
}
