/** @module 책임: 기관 회차 이력 조회 port와 mart 요약 한 행의 application record 형태를 소유한다. */
import type { BaseRelativeBidRate, BidRate, Money, ObservedBidRate, Temporal } from "@eatbid/domain";
import type { MartBuildLineage } from "./mart-build-lineage";
import type { OrganizationId } from "../domain/organization-id";

/**
 * mart.org_round_summary 한 행을 도메인 값으로만 표현한다. 계보는 행이 아니라 build가 갖는다
 * (ADR 0034) — 같은 사실을 수백만 행에 복제하면 권위가 둘이 된다.
 * 비율은 일반 percentage-point가 아니다. 관측 사정률(`ObservedBidRate`)의 분모는 예정가격이고 그날 하한·투찰률 축
 * 낙찰률(`BaseRelativeBidRate`)의 분모는 기초금액이라 축이 다르다. scale과 범위는 어댑터 경계에서 한
 * 번만 닫고, 직렬화 단계는 그 값을 다시 검증하지 않는다.
 */
export interface OrganizationAttemptRecord {
  readonly attemptId: bigint;
  readonly announcedAt: Temporal.Instant;
  readonly openedAt: Temporal.Instant | null;
  readonly item: { readonly codeValueId: bigint; readonly label: string } | null;
  readonly floorRate: BidRate | null;
  readonly baseAmount: Money;
  readonly winRate: ObservedBidRate | null;
  readonly secondRate: ObservedBidRate | null;
  /** `winRate`와 같은 낙찰의 투찰률 축 표현이다. 대체재가 아니라 짝이므로 둘 다 싣는다. */
  readonly awardedBidRate: BaseRelativeBidRate | null;
  readonly dayFloorRate: BaseRelativeBidRate | null;
  readonly listCount: number | null;
  readonly belowDayFloorCount: number | null;
  readonly winnerSupplierPartyId: bigint | null;
  readonly supersedesAttemptId: bigint | null;
}

export interface OrganizationAttemptQuery {
  readonly organizationId: OrganizationId;
  readonly itemCodeValueId: bigint | null;
  readonly cursor: bigint | null;
  readonly limit: number;
  /**
   * 개찰 시각이 이 시각 이하인 회차만 읽는다. null이면 개찰 여부로 거르지 않는다. 시각은 use case가
   * 주입된 clock에서 한 번 읽어 넘기므로 어댑터는 현재 시각을 스스로 알지 못한다(AGENTS 15·17).
   * 개찰 시각이 미관측인 회차는 개찰됐다고 단정할 수 없어 기준이 있으면 빠진다(AGENTS 3).
   */
  readonly openedAtOrBefore: Temporal.Instant | null;
}

/**
 * `sampleCount`는 cursor 위치와 무관하게 필터 조건을 만족하는 전체 회차 수다.
 * 페이지 길이로 대신하면 지표의 표본 수가 스크롤 위치에 따라 달라진다.
 * `lineage`는 이 페이지를 읽은 활성 build 하나다. 아직 빌드된 적이 없으면 null이며 그것은 오류가
 * 아니라 파생물이 아직 만들어지지 않은 정상 상태다(ADR 0011, ADR 0034).
 */
export interface OrganizationAttemptPage {
  readonly attempts: readonly OrganizationAttemptRecord[];
  readonly nextCursor: bigint | null;
  readonly sampleCount: number;
  readonly lineage: MartBuildLineage | null;
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
