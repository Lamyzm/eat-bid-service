/** @module 책임: PostgreSQL 연결 수명주기를 감추고 목적별 조회·트랜잭션 port만 주입 가능하게 만든다. */
import { DynamicModule, Global, Module, type Provider } from "@nestjs/common";
import type { AccountRepository } from "../../modules/account/application/account-repository";
import { DrizzleAccountRepository } from "../../modules/account/infrastructure/drizzle/drizzle-account-repository";
import type { AuctionReader } from "../../modules/procurement/application/auction-reader";
import type { AuctionRosterReader } from "../../modules/procurement/application/auction-roster-reader";
import { DrizzleAuctionRosterReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-auction-roster-reader";
import type { OpenAuctionReader } from "../../modules/procurement/application/open-auction-reader";
import type { OrganizationAttemptReader } from "../../modules/procurement/application/organization-attempt-reader";
import type { WinRateDistributionReader } from "../../modules/procurement/application/win-rate-distribution-reader";
import type { CodeReader } from "../../modules/reference/application/code-reader";
import { DrizzleAuctionReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-auction-reader";
import { DrizzleOpenAuctionReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-open-auction-reader";
import { DrizzleOrganizationAttemptReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-organization-attempt-reader";
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
  OPEN_AUCTION_READER,
  ORGANIZATION_ATTEMPT_READER,
  UNIT_OF_WORK,
  WIN_RATE_DISTRIBUTION_READER,
} from "./database.tokens";
import { createUnitOfWork, type UnitOfWork } from "./unit-of-work";

export interface DatabaseModuleOverrides {
  /** bootstrap이 인증 전송보다 먼저 만든 연결이다. 주지 않으면 모듈이 자기 풀을 연다. */
  readonly connection?: ManagedDatabase;
  readonly readiness?: DatabaseReadiness;
  readonly accountRepository?: AccountRepository;
  readonly auctionReader?: AuctionReader;
  readonly auctionRosterReader?: AuctionRosterReader;
  readonly openAuctionReader?: OpenAuctionReader;
  readonly organizationAttemptReader?: OrganizationAttemptReader;
  readonly winRateDistributionReader?: WinRateDistributionReader;
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
    ];
    return {
      global: true,
      module: DatabaseModule,
      providers,
      exports: [
        ACCOUNT_REPOSITORY,
        DATABASE_READINESS,
        UNIT_OF_WORK,
        AUCTION_READER,
        AUCTION_ROSTER_READER,
        OPEN_AUCTION_READER,
        ORGANIZATION_ATTEMPT_READER,
        WIN_RATE_DISTRIBUTION_READER,
        CODE_READER,
      ],
    };
  }
}
