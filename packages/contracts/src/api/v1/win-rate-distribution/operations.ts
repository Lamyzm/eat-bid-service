/** @module 책임: v1 낙찰률 분포 조회의 semantic route·코호트 query·상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";

import { kstMonthTextSchema } from "../../../atoms/calendar";
import { bidRateTextSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../../operation";
import { distributionScopeSchema } from "./distribution.resource";
import { winRateDistributionV1ResponseSchema } from "./find-win-rate-distribution.response";

// 빌더의 저장 폭과 같다(`mart.derivations.DISTRIBUTION_BIN_WIDTH`). 요청 폭이 저장 폭의 정수배인지는
// 활성 build의 실제 폭으로 판정해야 하므로 계약이 아니라 use case가 확인한다.
const DEFAULT_BIN_WIDTH = "0.010";

// 화면 기간 칩의 최장이 12개월이고, 상한이 있어야 응답 크기와 DB 스캔 행 수가 닫힌다.
const MAX_PERIOD_MONTHS = 12;

function monthOrdinal(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
}

type DistributionQuery = {
  scope: z.infer<typeof distributionScopeSchema>;
  regionCodeValueId?: string;
  organizationId?: string;
  from?: string;
  to?: string;
};

function reject(ctx: z.core.ParsePayload<DistributionQuery>, path: string, message: string): void {
  ctx.issues.push({ code: "custom", message, input: ctx.value, path: [path] });
}

/**
 * 모집단과 축의 짝을 계약이 소유한다. mart의 `win_rate_distribution_monthly_scope_axis_required`
 * check 제약과 같은 규칙이며, 여기서 막지 않으면 어느 모집단의 행을 읽는지 말할 수 없는 요청이
 * 어댑터까지 내려간다. discriminated union으로 만들면 OpenAPI 생성기의 `queryObject`가 parameter를
 * 통째로 빠뜨리므로(설계 §1) 규칙은 `.check()`로 붙이고 문장으로 summary에 적는다.
 *
 * 기간은 양끝을 함께 받거나 둘 다 생략한다. 한쪽만 받으면 나머지 끝을 서버가 지어내야 하고 그러면
 * 응답만으로 표본을 재현할 수 없다(AGENTS 7).
 */
function cohortAxisRule(ctx: z.core.ParsePayload<DistributionQuery>): void {
  const { scope, regionCodeValueId, organizationId, from, to } = ctx.value;
  const needsRegion = scope === "province" || scope === "district";
  if ((regionCodeValueId !== undefined) !== needsRegion) {
    reject(ctx, "regionCodeValueId", needsRegion
      ? "도·시군 모집단은 지역 코드값 id를 요구합니다."
      : "이 모집단은 지역 축을 갖지 않습니다.");
  }
  const needsOrganization = scope === "organization";
  if ((organizationId !== undefined) !== needsOrganization) {
    reject(ctx, "organizationId", needsOrganization
      ? "기관 모집단은 기관 id를 요구합니다."
      : "이 모집단은 기관 축을 갖지 않습니다.");
  }
  if ((from === undefined) !== (to === undefined)) {
    reject(ctx, from === undefined ? "from" : "to", "기간은 양끝을 함께 지정하거나 둘 다 생략해야 합니다.");
    return;
  }
  if (from === undefined || to === undefined) return;
  const months = monthOrdinal(to) - monthOrdinal(from) + 1;
  if (months < 1) reject(ctx, "to", "기간의 끝은 시작보다 앞설 수 없습니다.");
  else if (months > MAX_PERIOD_MONTHS) reject(ctx, "to", `기간은 ${MAX_PERIOD_MONTHS}개월을 넘을 수 없습니다.`);
}

export const winRateDistributionQuerySchema = z.strictObject({
  scope: distributionScopeSchema,
  // 지역과 기관은 문자열 코드가 아니라 숫자 id로 받는다. 문자열 코드를 URL 식별자로 쓰면 체계가
  // 암묵으로 딸려 오고 그것이 AGENTS 2가 금지하는 문자열 정체성이다. 응답 meta의 `regionScheme`이
  // 그 id가 어느 체계의 것인지 말한다.
  regionCodeValueId: positiveBigintTextSchema.optional(),
  organizationId: positiveBigintTextSchema.optional(),
  // 하한율과 낙찰방식은 필수다. 하한율 90과 88은 사정률 축에서 겹치지 않는 자리에 살고 단가입찰의
  // 사정률은 총액과 같은 축이 아니라, 합산하면 "없는 두 봉우리"가 생긴다(설계 §2.1).
  floorRate: bidRateTextSchema,
  awardMethod: positiveBigintTextSchema,
  from: kstMonthTextSchema.optional(),
  to: kstMonthTextSchema.optional(),
  binWidth: bidRateTextSchema.default(DEFAULT_BIN_WIDTH),
  // `total`은 기간 합산 칸만, `month`는 달별 칸까지 싣는다. 크게 보기(12개월 × 칸 히트맵)가 두 번째
  // endpoint 없이 같은 계약으로 그려진다.
  granularity: z.enum(["total", "month"]).default("total"),
}).check(cohortAxisRule);

export const winRateDistributionV1Operations = {
  find: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "win-rate-distribution", segments: [] },
    operationId: "findWinRateDistribution",
    implementationOwner: "server",
    summary: "모집단·코호트별 낙찰 사정률 분포를 달 단위로 합산해 조회한다. 전국은 지역·기관 축이 없어야 하고,"
      + " 도·시군은 regionCodeValueId만, 이 기관은 organizationId만 가져야 한다. 기간은 양끝을 함께 지정하며 12개월을 넘을 수 없다.",
    tags: ["공고와 분석"],
    pathSchema: z.strictObject({}),
    querySchema: winRateDistributionQuerySchema,
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "낙찰률 분포 조회 성공", schema: winRateDistributionV1ResponseSchema },
    },
    problemResponses: {
      400: {
        description: "query가 유효하지 않거나 모집단과 축의 짝, 기간 상한, 칸 폭 배수 규칙을 어김",
        schema: problemDetailsSchema,
      },
      ...unauthenticatedProblemResponse,
      404: { description: "요청한 기관 또는 지역 코드값을 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const winRateDistributionV1OperationRegistry = createOperationRegistry([
  winRateDistributionV1Operations.find,
] as const);
