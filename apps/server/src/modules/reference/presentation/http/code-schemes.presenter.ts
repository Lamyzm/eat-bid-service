/** @module 책임: 코드 목록 조회 record를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import type { ListCodesV1Response, RegionCodeV1 } from "@eatbid/contracts";
import { bigintText, instantText } from "../../../../platform/http/wire";
import type { CodeReleaseListing, RegionCodeRecord } from "../../application/code-reader";

function toRegionCode(scheme: string, record: RegionCodeRecord): RegionCodeV1 {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    codeValueId: bigintText(record.codeValueId),
    scheme,
    code: record.code,
    label: record.label,
    parentCodeValueId: bigintText(record.parentCodeValueId),
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
      codeReleaseId: bigintText(listing.release.codeReleaseId),
      sourceVersion: listing.release.sourceVersion,
      publishedAt: instantText(listing.release.publishedAt),
      promotedGrain: [...listing.release.promotedGrain],
      // 좌표 없는 코드 수를 응답이 직접 센다. 지도에 서지 않는 구가 몇 개인지는 숨기면 "그 지역에
      // 공고가 없다"로 읽힌다(ADR 0035 Consequences).
      codesWithoutCoordinateCount: listing.codes.filter((record) => record.coordinate === null).length,
    },
  };
}
