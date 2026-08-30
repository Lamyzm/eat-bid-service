import { DynamicModule, Global, Module, type OnApplicationShutdown, type Provider } from "@nestjs/common";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AuctionReader } from "../../modules/procurement/application/auction-reader";
import { DrizzleAuctionReader } from "../../modules/procurement/infrastructure/drizzle/drizzle-auction-reader";
import type { Environment } from "../config/environment";
import type { DatabaseReadiness } from "../health/readiness-state";
import { createDatabaseReadiness } from "./database-readiness";
import {
  AUCTION_READER,
  DATABASE_CONNECTION,
  DATABASE_READINESS,
  UNIT_OF_WORK,
} from "./database.tokens";
import { createUnitOfWork, type UnitOfWork } from "./unit-of-work";

export interface DatabaseModuleOverrides {
  readonly readiness?: DatabaseReadiness;
  readonly auctionReader?: AuctionReader;
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
    await this.client.end();
  }
}

@Global()
@Module({})
export class DatabaseModule {
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
    ];
    return {
      global: true,
      module: DatabaseModule,
      providers,
      exports: [DATABASE_READINESS, UNIT_OF_WORK, AUCTION_READER],
    };
  }
}
