/** @module 책임: PostgreSQL 연결 수명주기를 감추고 목적별 조회·트랜잭션 port만 주입 가능하게 만든다. */
import { DynamicModule, Global, Module, type OnApplicationShutdown, type Provider } from "@nestjs/common";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AuctionReader } from "../../modules/procurement/application/auction-reader";
import type { OrganizationAttemptReader } from "../../modules/procurement/application/organization-attempt-reader";
import { DrizzleAuctionReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-auction-reader";
import { DrizzleOrganizationAttemptReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-organization-attempt-reader";
import type { Environment } from "../config/environment";
import type { DatabaseReadiness } from "../health/readiness-state";
import { createDatabaseReadiness } from "./database-readiness";
import {
  AUCTION_READER,
  DATABASE_CONNECTION,
  DATABASE_READINESS,
  ORGANIZATION_ATTEMPT_READER,
  UNIT_OF_WORK,
} from "./database.tokens";
import { createUnitOfWork, type UnitOfWork } from "./unit-of-work";

export interface DatabaseModuleOverrides {
  readonly readiness?: DatabaseReadiness;
  readonly auctionReader?: AuctionReader;
  readonly organizationAttemptReader?: OrganizationAttemptReader;
}

class ManagedDatabase implements OnApplicationShutdown {
  readonly client: ReturnType<typeof postgres>;
  readonly database: ReturnType<typeof drizzle>;

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl, {
      max: 10,
      connection: { application_name: "eatbid-api" },
    });
    this.database = drizzle({ client: this.client });
  }

  async onApplicationShutdown(): Promise<void> {
    // Nest 자원 종료 단계가 풀의 유일한 소유자여야 drain 전에 연결이 먼저 끊기지 않는다.
    await this.client.end();
  }
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
        useFactory: () => new ManagedDatabase(environment.databaseUrl),
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
        provide: ORGANIZATION_ATTEMPT_READER,
        inject: [DATABASE_CONNECTION],
        useFactory: (connection: ManagedDatabase): OrganizationAttemptReader =>
          overrides.organizationAttemptReader ?? new DrizzleOrganizationAttemptReader(connection.database),
      },
    ];
    return {
      global: true,
      module: DatabaseModule,
      providers,
      exports: [DATABASE_READINESS, UNIT_OF_WORK, AUCTION_READER, ORGANIZATION_ATTEMPT_READER],
    };
  }
}
