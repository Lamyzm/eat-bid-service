/** @module 책임: v1 참가제한지역 목록 조회와 선택 미리보기의 semantic route·입력·상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";

import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../../operation";
import { listEligibilityAreasV1ResponseSchema } from "./list-eligibility-areas.response";
import { previewRegionCoverageCommandSchema, REGION_COVERAGE_WINDOW_DAYS } from "./region-coverage.command";
import { regionCoverageV1ResponseSchema } from "./region-coverage.response";

const areaProblems = {
  ...unauthenticatedProblemResponse,
  500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
  503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
} as const;

export const eligibilityAreaV1Operations = {
  /**
   * `listCodes`를 쓰지 않고 별도 operation을 두는 이유는 셋이다. 첫째, `listCodes`는 **활성
   * `core.code_release`가 있는 체계**만 답하고 없으면 404인데 `eat:eligibility-area`에는 release가 없다
   * (release 1건은 행정안전부 체계 하나뿐, 2026-09-11 복원본 실측). 둘째, 그 응답의 행 계약
   * (`RegionCodeV1`)은 라벨을 필수로 요구하는데 이 체계에는 라벨이 관측되지 않은 코드가 실제로 있다
   * (186개 중 2개). 셋째, 화면이 필요한 것은 평평한 코드 목록이 아니라 시도로 접히는 묶음이다.
   * release 없이 좌표·계층·유효기간을 지어내지 않으려면 계약을 나누는 편이 정직하다(ADR 0048).
   */
  listEligibilityAreas: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "eligibility-areas", segments: [] },
    operationId: "listEligibilityAreas",
    implementationOwner: "server",
    summary: "공고가 참가를 제한할 때 쓰는 지역 코드를 시도 묶음으로 조회한다."
      + " 라벨이 관측되지 않은 코드도 감추지 않고 그 수를 meta에 싣는다.",
    tags: ["코드 사전"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "참가제한지역 목록 조회 성공", schema: listEligibilityAreasV1ResponseSchema },
    },
    problemResponses: areaProblems,
  }),
  previewRegionCoverage: defineOperation({
    method: "post",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "eligibility-areas", segments: ["coverage"] },
    operationId: "previewRegionCoverage",
    implementationOwner: "server",
    summary: `지역 선택 하나가 오늘 몇 건을 잡고 지난 ${REGION_COVERAGE_WINDOW_DAYS}일 중 몰리는 날 최대`
      + " 몇 건이었는지를 실제 조회로 답한다. 저장하지 않은 선택으로도 물을 수 있다.",
    tags: ["코드 사전"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: previewRegionCoverageCommandSchema,
    successResponses: {
      200: { description: "지역 선택 미리보기 성공", schema: regionCoverageV1ResponseSchema },
    },
    problemResponses: {
      400: { description: "요청 본문이 유효하지 않음", schema: problemDetailsSchema },
      ...areaProblems,
    },
  }),
} as const;

export const eligibilityAreaV1OperationRegistry = createOperationRegistry([
  eligibilityAreaV1Operations.listEligibilityAreas,
  eligibilityAreaV1Operations.previewRegionCoverage,
] as const);
