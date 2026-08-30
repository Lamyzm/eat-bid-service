import { Injectable } from "@nestjs/common";
import { Effect } from "effect";

export interface EffectRunOptions {
  readonly signal?: AbortSignal;
}

@Injectable()
export class EffectRunner {
  /** Effect를 Promise와 AbortSignal로 번역하는 유일한 런타임 경계이며 환경 의존성은 받지 않는다. */
  async run<A, E>(
    effect: Effect.Effect<A, E, never>,
    options: EffectRunOptions = {},
  ): Promise<A> {
    try {
      return await Effect.runPromise(effect, { signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }
      throw error;
    }
  }
}
