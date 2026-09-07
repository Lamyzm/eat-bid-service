/** @module 책임: v1 기관 회차 이력 조회의 semantic route·query·상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";
import { kstMonthTextSchema } from "../../../atoms/calendar";
import { organizationAttemptAwardMethodFilterSchema, organizationAttemptFloorFilterSchema } from "./cohort.resource";

import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { problemDetailsSchema } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation, pathParameter } from "../../operation";
import { organizationAttemptOpenedFilterSchema } from "./attempt.resource";
import { organizationAuctionAttemptsV1ResponseSchema } from "./list-auction-attempts.response";

// 기본값 12는 결정 화면 과거 회차 표가 그리는 12행이다. 첫 화면이 표를 채우는 데 필요한 만큼만
// 받아 흐름 차트와 표가 같은 한 응답을 쓴다.
const DEFAULT_ATTEMPT_LIMIT = 12;
// 기본값이 `only`인 이유: 이 응답의 첫 소비자인 과거 회차 표·흐름 차트는 개찰된 회차만 그려야 하고,
// 열린 회차를 표에 섞으면 아직 없는 낙찰률 자리가 과거처럼 읽힌다(EAT-81).
const DEFAULT_OPENED_FILTER = "only";

/** 기간을 반쪽만 받거나 60개월을 넘기면 화면과 응답이 같은 표본을 재현할 수 없어 요청에서 닫는다. */
function periodRule(ctx: z.core.ParsePayload<{ from?: string; to?: string }>): void {
  const { from, to } = ctx.value;
  if (from === undefined && to === undefined) return;
  if (from === undefined || to === undefined) {
    ctx.issues.push({ code: "custom", input: ctx.value, path: [from === undefined ? "from" : "to"], message: "기간은 양끝을 함께 지정해야 합니다." });
    return;
  }
  const ordinal = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  const months = ordinal(to) - ordinal(from) + 1;
  if (months < 1 || months > 60) {
    ctx.issues.push({ code: "custom", input: ctx.value, path: ["to"], message: "기간은 시간순으로 1~60개월이어야 합니다." });
  }
}

export const organizationAuctionAttemptsQuerySchema = z.strictObject({
  item: positiveBigintTextSchema.optional(),
  cursor: positiveBigintTextSchema.optional(),
  // 상한 200은 pages-endpoints-load.md의 "기관 회차 ≤ 200" 점 조회 상한과 같다.
  limit: z.coerce.number().int().min(1).max(200).default(DEFAULT_ATTEMPT_LIMIT),
  opened: organizationAttemptOpenedFilterSchema.default(DEFAULT_OPENED_FILTER),
  // 하나라도 명시하면 조건 meta·행별 낙찰 방식이 포함된다. 기존 무지정 요청의 strict 응답은 유지한다.
  floorRate: organizationAttemptFloorFilterSchema.optional(),
  awardMethod: organizationAttemptAwardMethodFilterSchema.optional(),
  from: kstMonthTextSchema.optional(),
  to: kstMonthTextSchema.optional(),
}).check(periodRule);

export type OrganizationAuctionAttemptsQuery = z.input<typeof organizationAuctionAttemptsQuerySchema>;

export const organizationV1Operations = {
  listAuctionAttempts: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "organizations", segments: [pathParameter("organizationId"), "auction-attempts"] },
    operationId: "listOrganizationAuctionAttempts",
    implementationOwner: "server",
    summary: "기관의 회차 요약을 최근 순으로 조회한다. 하한율·낙찰 방식은 정확한 값/all/unknown으로 구분하고,"
      + " 개찰월 기간은 양끝을 함께 지정하며 60개월을 넘을 수 없다. 새 조건을 명시하면 조건 meta와 행별 낙찰 방식을 포함한다.",
    tags: ["procurement"],
    pathSchema: z.strictObject({ organizationId: positiveBigintTextSchema }),
    querySchema: organizationAuctionAttemptsQuerySchema.default({
      limit: DEFAULT_ATTEMPT_LIMIT,
      opened: DEFAULT_OPENED_FILTER,
    }),
    bodySchema: z.undefined(),
    successResponses: { 200: { description: "기관 회차 요약 조회 성공", schema: organizationAuctionAttemptsV1ResponseSchema } },
    problemResponses: {
      400: { description: "기관 ID 또는 query가 유효하지 않음", schema: problemDetailsSchema },
      404: { description: "기관을 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const organizationV1OperationRegistry = createOperationRegistry([organizationV1Operations.listAuctionAttempts] as const);
