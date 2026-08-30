import { DynamicModule, Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import type { Environment } from "./environment";

export const ENVIRONMENT = Symbol("ENVIRONMENT");

@Global()
@Module({})
export class PlatformConfigModule {
  static forEnvironment(environment: Environment): DynamicModule {
    return {
      module: PlatformConfigModule,
      imports: [NestConfigModule.forRoot({
        cache: true,
        ignoreEnvFile: true,
        isGlobal: true,
        skipProcessEnv: true,
        load: [() => ({ environment })],
      })],
      providers: [{ provide: ENVIRONMENT, useValue: environment }],
      exports: [ENVIRONMENT, NestConfigModule],
    };
  }
}
