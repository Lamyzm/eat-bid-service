/** @module 책임: 코드 목록 조회 use case와 그 예상 실패 분류를 소유한다. */
import { Effect } from "effect";
import type { CodeReader, CodeReleaseListing } from "./code-reader";

export interface ListCodesInput {
  readonly scheme: string;
  readonly grain: string | null;
}

/**
 * 알 수 없는 체계와 활성 release가 없는 체계를 같은 실패로 묶는다. 둘 다 "이 체계로는 아직 답할 수
 * 없다"이고, 둘을 응답에서 갈라 주면 어떤 체계 이름이 저장소에 존재하는지가 공개 응답으로 새어 나간다.
 */
export class CodeReleaseNotFound extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor(readonly scheme: string) {
    super(`Active code release for scheme ${scheme} was not found`);
    this.name = "CodeReleaseNotFound";
  }
}

export class CodeDependencyUnavailable extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;

  constructor(cause: unknown) {
    super("Reference repository is unavailable", { cause });
    this.name = "CodeDependencyUnavailable";
  }
}

export class ListCodes {
  constructor(private readonly reader: CodeReader) {}

  /** 공개 응답이 아니라 활성 release의 내부 listing을 돌려준다. wire 직렬화는 presenter가 한다(ADR 0045 결정 1). */
  execute(input: ListCodesInput): Effect.Effect<
    CodeReleaseListing,
    CodeReleaseNotFound | CodeDependencyUnavailable,
    never
  > {
    // "없음"과 의존성 장애를 타입이 있는 실패 채널로 분리해 HTTP 계층이 결함과 혼동하지 않게 한다.
    return Effect.tryPromise({
      try: () => this.reader.readActiveRelease({ scheme: input.scheme, grain: input.grain }),
      catch: (cause) => new CodeDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((listing) => listing === null
        ? Effect.fail(new CodeReleaseNotFound(input.scheme))
        : Effect.succeed(listing)),
    );
  }
}
