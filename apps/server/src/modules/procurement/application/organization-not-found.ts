/**
 * @module 책임: 분석 조회가 가리킨 구매기관이 없을 때의 typed failure를 소유한다.
 *
 * 요청의 기관이 없으면 빈 그림이 아니라 404로 닫아야 화면이 "자료 없음"과 "없는 기관"을 가른다.
 */
import { organizationIdToString, type OrganizationId } from "../domain/organization-id";

export class OrganizationNotFound extends Error {
  readonly code = "ORGANIZATION_NOT_FOUND" as const;

  constructor(readonly organizationId: OrganizationId) {
    super(`Organization ${organizationIdToString(organizationId)} was not found`);
    this.name = "OrganizationNotFound";
  }
}
