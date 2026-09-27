/**
 * @module 책임: 분석 조회가 받은 기관·비교 지역 축이 실제로 있는지 확인하고, 없음을 표본 0과 다른 실패로 낸다.
 *
 * 시간축·조건 사전·전체 이력이 같은 확인을 한다. 세 벌로 두면 한 벌만 고쳐져 같은 요청이 조회마다 다른
 * 상태(404와 빈 목록)로 답하게 된다.
 */
import { Effect } from "effect";
import { ProcurementDependencyUnavailable } from "./failures";
import { OrganizationNotFound } from "./organization-not-found";
import type { AnalysisComparisonScope, AnalysisRegionScheme } from "./analysis-time-series-reader";
import type { OrganizationId } from "../domain/organization-id";

/**
 * 비교 지역의 코드값이 그 체계 안에 없다는 사실이다. 표본 0의 빈 결과로 뭉개지 않는 이유는 사용자가
 * 할 일이 다르기 때문이다 — 없는 지역은 조건을 고쳐야 하고, 표본 0은 기간이나 조건을 넓혀야 한다.
 */
export class AnalysisRegionNotFound extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor(readonly scheme: string, readonly codeValueId: bigint) {
    super(`Region code value ${codeValueId.toString(10)} was not found in ${scheme}`);
    this.name = "AnalysisRegionNotFound";
  }
}

export interface AnalysisAxisLookup {
  organizationExists(organizationId: bigint): Promise<boolean>;
  regionExists(scheme: AnalysisRegionScheme, codeValueId: bigint): Promise<boolean>;
}

function exists<Failure>(
  read: () => Promise<boolean>,
  missing: () => Failure,
): Effect.Effect<void, ProcurementDependencyUnavailable | Failure, never> {
  return Effect.tryPromise({
    try: read,
    catch: (cause): ProcurementDependencyUnavailable => new ProcurementDependencyUnavailable(cause),
  }).pipe(Effect.flatMap((found) => found ? Effect.succeed(undefined) : Effect.fail(missing())));
}

/**
 * 기관과 비교 지역을 함께 확인한다. 전국은 확인할 축이 없으므로 조회를 한 번 더 열지 않는다. 존재 확인을
 * 먼저 끝내야 "그 축이 없음"과 "조건에 맞는 회차가 없음"이 같은 빈 결과로 뭉개지지 않는다.
 */
export function assertAnalysisAxesExist(
  lookup: AnalysisAxisLookup,
  targetOrganizationId: OrganizationId,
  scope: AnalysisComparisonScope,
): Effect.Effect<void, ProcurementDependencyUnavailable | OrganizationNotFound | AnalysisRegionNotFound, never> {
  const organization = exists(
    () => lookup.organizationExists(targetOrganizationId),
    () => new OrganizationNotFound(targetOrganizationId),
  );
  if (scope.kind === "national") return organization;
  return organization.pipe(Effect.flatMap(() => exists(
    () => lookup.regionExists(scope.scheme, scope.codeValueId),
    () => new AnalysisRegionNotFound(scope.scheme, scope.codeValueId),
  )));
}
