import { Injectable } from "@nestjs/common";
import { Effect } from "effect";

export interface EffectRunOptions {
  readonly signal?: AbortSignal;
}

@Injectable()
export class EffectRunner {
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
