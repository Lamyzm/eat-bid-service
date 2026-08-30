import { DynamicModule, Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import type { DatabaseReadiness } from "./readiness-state";
import { ReadinessState } from "./readiness-state";
import { DATABASE_READINESS } from "../database/database.tokens";

export { DATABASE_READINESS } from "../database/database.tokens";
export type { DatabaseReadiness } from "./readiness-state";

@Module({})
export class HealthModule {
  static forState(readiness: ReadinessState): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [
        { provide: ReadinessState, useValue: readiness },
      ],
      exports: [ReadinessState],
    };
  }
}
