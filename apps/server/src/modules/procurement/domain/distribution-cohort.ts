/**
 * @module 책임: 분포 모집단과 그 모집단이 요구하는 축의 짝을 타입으로 닫는다.
 *
 * mart의 `win_rate_distribution_monthly_scope_axis_required` check 제약과 같은 규칙이다. 판별 union으로
 * 두면 "전국인데 지역 id가 있는" 값이 어댑터까지 내려갈 수 없고, 어느 모집단의 행을 읽는지 코드가
 * 스스로 말한다.
 */
import type { OrganizationId } from "./organization-id";

export type DistributionCohort =
  | { readonly scope: "national" }
  | { readonly scope: "province" | "district"; readonly regionCodeValueId: bigint }
  | { readonly scope: "organization"; readonly organizationId: OrganizationId };

export function cohortRegionCodeValueId(cohort: DistributionCohort): bigint | null {
  return cohort.scope === "province" || cohort.scope === "district" ? cohort.regionCodeValueId : null;
}

export function cohortOrganizationId(cohort: DistributionCohort): OrganizationId | null {
  return cohort.scope === "organization" ? cohort.organizationId : null;
}
