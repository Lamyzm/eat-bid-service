/** @module 책임: 코드 목록 조회의 예상 실패 분류와 application record→공개 V1 응답 직렬화를 소유한다. */
import {
  instantCodec,
  type ListCodesV1Response,
  type RegionCodeV1,
} from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";
import { Effect } from "effect";
import { z } from "zod";
import type { CodeReader, CodeReleaseListing, RegionCodeRecord } from "./code-reader";

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

function instantText(value: Temporal.Instant | null): string | null {
  return value === null ? null : z.encode(instantCodec, value);
}

function toRegionCode(scheme: string, record: RegionCodeRecord): RegionCodeV1 {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    codeValueId: record.codeValueId.toString(10),
    scheme,
    code: record.code,
    label: record.label,
    parentCodeValueId: record.parentCodeValueId === null ? null : record.parentCodeValueId.toString(10),
    active: record.active,
    validFrom: instantText(record.validFrom),
    validTo: instantText(record.validTo),
    coordinate: record.coordinate,
  };
}

export function toListCodesResponse(scheme: string, listing: CodeReleaseListing): ListCodesV1Response {
  return {
    scheme,
    codes: listing.codes.map((record) => toRegionCode(scheme, record)),
    meta: {
      codeReleaseId: listing.release.codeReleaseId.toString(10),
      sourceVersion: listing.release.sourceVersion,
      publishedAt: instantText(listing.release.publishedAt),
      promotedGrain: [...listing.release.promotedGrain],
      // 좌표 없는 코드 수를 응답이 직접 센다. 지도에 서지 않는 구가 몇 개인지는 숨기면 "그 지역에
      // 공고가 없다"로 읽힌다(ADR 0035 Consequences).
      codesWithoutCoordinateCount: listing.codes.filter((record) => record.coordinate === null).length,
    },
  };
}

export class ListCodes {
  constructor(private readonly reader: CodeReader) {}

  execute(input: ListCodesInput): Effect.Effect<
    ListCodesV1Response,
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
        : Effect.succeed(toListCodesResponse(input.scheme, listing))),
    );
  }
}
