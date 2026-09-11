/**
 * @module 책임: 워크스페이스 관심 지역의 조회·통째 교체 port와 그 결과 record, 예상 실패를 정의한다.
 *
 * 등록 사업자 port와 나눈 이유는 함께 바뀌는 이유가 다르기 때문이다. 이쪽이 바뀌는 이유는 지역 축의
 * 코드 체계와 확인 규칙이고, 저쪽은 사업자번호 대조와 등록 소유다(ADR 0045).
 */
import type { Temporal } from "@eatbid/domain";

export interface RegionPreferenceAreaRecord {
  readonly codeValueId: bigint;
  readonly code: string;
  readonly scheme: string;
  readonly label: string | null;
}

/**
 * `confirmedAt`이 null이면 이 워크스페이스는 아직 지역을 확인하지 않았다. 코드를 하나도 고르지 않고
 * 확인만 한 상태(`areas`가 비었지만 `confirmedAt`이 있는 상태)와 구분된다 — 앞은 설정을 요청해야 하고
 * 뒤는 좁히지 않겠다는 사용자의 결정이다.
 */
export interface RegionPreferenceRecord {
  readonly areas: readonly RegionPreferenceAreaRecord[];
  readonly confirmedAt: Temporal.Instant | null;
}

export interface ReplaceRegionPreferenceInput {
  readonly workspaceId: bigint;
  readonly principalId: bigint;
  readonly codeValueIds: readonly bigint[];
}

/**
 * 참가제한지역 체계에 없는 코드는 저장하지 않고 요청 전체를 되돌린다. 아는 코드만 골라 저장하면
 * 사용자가 화면에서 본 선택과 저장된 선택이 조용히 달라진다.
 */
export type ReplaceRegionPreferenceResult =
  | { readonly kind: "replaced"; readonly preference: RegionPreferenceRecord }
  | { readonly kind: "unknown-area" };

export interface RegionPreferenceRepository {
  readPreference(workspaceId: bigint): Promise<RegionPreferenceRecord>;
  replacePreference(input: ReplaceRegionPreferenceInput): Promise<ReplaceRegionPreferenceResult>;
}

export class RegionPreferenceDependencyUnavailable extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;

  constructor(cause: unknown) {
    super("Region preference repository is unavailable", { cause });
    this.name = "RegionPreferenceDependencyUnavailable";
  }
}

export class RegionPreferenceAreaUnknown extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor() {
    super("Selected code values are not participation-restriction areas");
    this.name = "RegionPreferenceAreaUnknown";
  }
}
