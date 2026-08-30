import { DynamicModule, Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { DATABASE_READINESS, type DatabaseReadiness, ReadinessState } from "./readiness-state";

export { DATABASE_READINESS, type DatabaseReadiness } from "./readiness-state";

const availableDatabase: DatabaseReadiness = { isReady: () => true };

@Module({})
export class HealthModule {
  static forState(
    readiness: ReadinessState,
    databaseReadiness: DatabaseReadiness = availableDatabase,
  ): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [
        { provide: ReadinessState, useValue: readiness },
        { provide: DATABASE_READINESS, useValue: databaseReadiness },
      ],
      exports: [ReadinessState, DATABASE_READINESS],
    };
  }
}
