/** @module 책임: 코드 체계별 활성 release 조회 port와 저장 기술을 드러내지 않는 application record를 소유한다. */
import type { Temporal } from "@eatbid/domain";

/**
 * 좌표는 코드의 속성이 아니라 별도 관측이므로 값 하나로 묶어 옮긴다(ADR 0035 결정 5).
 * 위경도가 wire에서 JSON number인 것은 공개 계약의 선택이고, 그 변환 경계는 어댑터 하나뿐이다.
 */
export interface ObservedCoordinateRecord {
  readonly latitude: number;
  readonly longitude: number;
  readonly crs: "EPSG:4326";
}

/**
 * release가 말한 코드 한 행이다. 정체성은 `codeValueId`이고 `code`·`label`은 표시와 대조를 위한
 * 관측 사실이라 조인 키가 아니다(AGENTS 2). `grain`은 release가 기록한 승격 단계 이름 그대로다.
 */
export interface RegionCodeRecord {
  readonly codeValueId: bigint;
  readonly code: string;
  readonly label: string;
  readonly parentCodeValueId: bigint | null;
  readonly grain: string;
  readonly active: boolean;
  // null은 "처음부터"가 아니라 "원본이 날짜를 주지 않았다"다. 추정 경계를 만들지 않는다(ADR 0035 결정 4).
  readonly validFrom: Temporal.Instant | null;
  readonly validTo: Temporal.Instant | null;
  readonly coordinate: ObservedCoordinateRecord | null;
}

/** 응답이 어느 release를 읽었는지는 목록 자체만큼 중요한 사실이다. 개편 전후가 화면에서 같아 보이면 안 된다. */
export interface CodeReleaseRecord {
  readonly codeReleaseId: bigint;
  readonly sourceVersion: string;
  readonly publishedAt: Temporal.Instant | null;
  readonly promotedGrain: readonly string[];
}

export interface CodeReleaseListing {
  readonly release: CodeReleaseRecord;
  readonly codes: readonly RegionCodeRecord[];
}

export interface CodeListingQuery {
  readonly scheme: string;
  // null은 "모든 grain"이다. 값 목록은 계약이 아니라 release의 `promotedGrain`이 소유한다.
  readonly grain: string | null;
}

/**
 * "활성 release가 없다"와 "그 release에 코드가 없다"를 null과 빈 배열로 나눠야 화면이 아직 적재하지
 * 않은 체계를 코드가 없는 체계로 읽지 않는다(AGENTS 3).
 */
export interface CodeReader {
  readActiveRelease(query: CodeListingQuery): Promise<CodeReleaseListing | null>;
}
