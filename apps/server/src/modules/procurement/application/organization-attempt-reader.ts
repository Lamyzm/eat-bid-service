/** @module 책임: 기관 회차 이력 조회 port와 mart 요약 한 행의 application record 형태를 소유한다. */
import type { Money, PercentagePoints, Temporal } from "@eatbid/domain";
import type { OrganizationId } from "../domain/organization-id";

/**
 * mart.org_round_summary 한 행을 도메인 값으로만 표현한다. 계산 출처(mart_release,
 * computed_at, calc_version)를 행마다 들고 다녀야 화면이 어떤 파생 릴리스를 본 것인지 재현된다.
 */
export interface OrganizationAttemptRecord {
  readonly attemptId: bigint;
  readonly announcedAt: Temporal.Instant;
  readonly openedAt: Temporal.Instant | null;
  readonly item: { readonly codeValueId: bigint; readonly label: string } | null;
  readonly floorRate: PercentagePoints | null;
  readonly baseAmount: Money;
  readonly winRate: PercentagePoints | null;
  readonly secondRate: PercentagePoints | null;
  readonly dayFloorRate: PercentagePoints | null;
  readonly listCount: number | null;
  readonly invalidCount: number | null;
  readonly winnerSupplierPartyId: bigint | null;
  readonly supersedesAttemptId: bigint | null;
  readonly martRelease: string;
  readonly computedAt: Temporal.Instant;
  readonly calcVersion: string;
}

export interface OrganizationAttemptQuery {
  readonly organizationId: OrganizationId;
  readonly itemCodeValueId: bigint | null;
  readonly cursor: bigint | null;
  readonly limit: number;
}

/**
 * `sampleCount`는 cursor 위치와 무관하게 필터 조건을 만족하는 전체 회차 수다.
 * 페이지 길이로 대신하면 지표의 표본 수가 스크롤 위치에 따라 달라진다.
 */
export interface OrganizationAttemptPage {
  readonly attempts: readonly OrganizationAttemptRecord[];
  readonly nextCursor: bigint | null;
  readonly sampleCount: number;
}

/**
 * cursor는 요청한 기관의 회차만 가리켜야 한다. 다른 기관의 회차나 이미 사라진 회차를 빈 페이지로
 * 돌려주면 호출자가 "이력 끝"과 "잘못된 cursor"를 구분하지 못하므로 결과 자체로 구분한다.
 */
export type OrganizationAttemptListing =
  | { readonly kind: "page"; readonly page: OrganizationAttemptPage }
  | { readonly kind: "cursor-not-found"; readonly cursor: bigint };

/** 존재 확인과 목록 조회를 나눠야 "기관 없음"과 "이력 없음"을 use case가 구분할 수 있다. */
export interface OrganizationAttemptReader {
  exists(id: OrganizationId): Promise<boolean>;
  listAttempts(query: OrganizationAttemptQuery): Promise<OrganizationAttemptListing>;
}
