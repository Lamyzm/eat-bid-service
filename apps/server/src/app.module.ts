import { DynamicModule, Module, type Type } from "@nestjs/common";
import { EffectModule } from "./platform/effect/effect.module";
import { PlatformConfigModule } from "./platform/config/config.module";
import type { Environment } from "./platform/config/environment";
import { HealthModule, type DatabaseReadiness } from "./platform/health/health.module";
import { ReadinessState } from "./platform/health/readiness-state";
import { LoggingModule, type RedactingJsonLogger } from "./platform/logging/logging.module";
import { RequestContextModule, type RequestContextStore } from "./platform/request-context/request-context.module";
import { DatabaseModule } from "./platform/database/database.module";
import type { AuctionReader } from "./modules/procurement/application/auction-reader";
import { ProcurementModule } from "./modules/procurement/procurement.module";

@Module({
  imports: [EffectModule],
})
export class AppModule {
  static forRuntime(runtime: AppModuleRuntime): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformConfigModule.forEnvironment(runtime.environment),
        LoggingModule.forLogger(runtime.logger),
        RequestContextModule.forStore(runtime.requestContext),
        DatabaseModule.forRuntime(runtime.environment, {
          readiness: runtime.databaseReadiness,
          auctionReader: runtime.auctionReader,
        }),
        HealthModule.forState(runtime.readiness),
        ProcurementModule,
        ...(runtime.testOnlyImports ?? []),
      ],
    };
  }
}

export interface AppModuleRuntime {
  readonly environment: Environment;
  readonly logger: RedactingJsonLogger;
  readonly requestContext: RequestContextStore;
  readonly readiness: ReadinessState;
  readonly databaseReadiness?: DatabaseReadiness;
  readonly auctionReader?: AuctionReader;
  readonly testOnlyImports?: readonly Type[];
}
