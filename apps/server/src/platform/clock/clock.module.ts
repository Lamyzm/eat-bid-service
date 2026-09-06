/**
 * @module 책임: 운영 시각 취득 지점을 Nest 주입 토큰 하나로 좁혀 use case가 ambient clock에 묶이지 않게 한다.
 *
 * `Temporal.Now`를 직접 부르는 자리는 `packages/domain`의 top-level `systemClock` 하나뿐이며(AGENTS 17),
 * 서버는 bootstrap이 고른 그 clock을 여기로만 넘긴다. 시각이 입력인 use case는 이 토큰을 주입받아야
 * test가 고정 시각으로 같은 규칙을 확인할 수 있다.
 */
import { DynamicModule, Global, Module } from "@nestjs/common";
import type { Clock } from "@eatbid/domain";

export const CLOCK = Symbol("CLOCK");

@Global()
@Module({})
export class ClockModule {
  static forClock(clock: Clock): DynamicModule {
    return {
      global: true,
      module: ClockModule,
      providers: [{ provide: CLOCK, useValue: clock }],
      exports: [CLOCK],
    };
  }
}
