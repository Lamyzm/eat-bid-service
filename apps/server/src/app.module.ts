/** @module 책임: 검증이 끝난 환경과 어댑터를 주입받아 루트 Nest 모듈 그래프를 조립만 한다. */
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
import type { OrganizationAttemptReader } from "./modules/procurement/application/organization-attempt-reader";
import { ProcurementModule } from "./modules/procurement/procurement.module";

@Module({
  imports: [EffectModule],
})
export class AppModule {
  /**
   * 루트 모듈은 조립만 담당한다. 환경 검증과 어댑터 생성이 끝난 값을 주입해야
   * 테스트 대역이 운영 부트스트랩을 우회하거나 모듈 로딩 중 I/O를 시작하지 않는다.
   */
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
          organizationAttemptReader: runtime.organizationAttemptReader,
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
  readonly organizationAttemptReader?: OrganizationAttemptReader;
  readonly testOnlyImports?: readonly Type[];
}
