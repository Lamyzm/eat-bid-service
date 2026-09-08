/** @module 책임: v1 기관 회차 이력 조회의 semantic route·query·상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";
import { kstMonthTextSchema } from "../../../atoms/calendar";
import { organizationAttemptAwardMethodFilterSchema, organizationAttemptFloorFilterSchema } from "./cohort.resource";

import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
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

/**
 * 다음 페이지가 첫 페이지와 같은 코호트를 이어 읽게 하는 한 쌍의 규칙이다.
 *
 * `expectedBuildId`만으로는 부족하다. `opened=only`의 기준 시각이 요청마다 서버 clock이면 같은
 * build에서도 그 사이 개찰된 회차가 새로 들어와 누적 목록에 없던 행이 끼어든다. 반대로 `asOf`만
 * 고정하면 mart 발행 뒤 다른 build의 같은 시각 집합을 읽는다. 두 값이 함께 있어야 코호트가 하나다.
 *
 * `opened=any`에는 비교 기준 자체가 없어 응답 `meta.asOf`가 null이므로 되돌려 보낼 값도 없다.
 * 없는 기준을 받아 두면 소비자는 서버가 쓰지 않는 값을 보내고도 고정됐다고 믿는다.
 */
function buildPinRule(
  ctx: z.core.ParsePayload<{ expectedBuildId?: string; asOf?: string; opened?: string }>,
): void {
  const { expectedBuildId, asOf, opened } = ctx.value;
  if (asOf !== undefined && expectedBuildId === undefined) {
    ctx.issues.push({ code: "custom", input: ctx.value, path: ["expectedBuildId"], message: "asOf는 expectedBuildId와 함께 지정해야 합니다." });
  }
  if (asOf !== undefined && opened === "any") {
    ctx.issues.push({ code: "custom", input: ctx.value, path: ["asOf"], message: "opened=any에는 비교 기준 시각이 없습니다." });
  }
  if (expectedBuildId !== undefined && opened === "only" && asOf === undefined) {
    ctx.issues.push({ code: "custom", input: ctx.value, path: ["asOf"], message: "opened=only를 고정하려면 첫 응답의 asOf가 필요합니다." });
  }
}

export const organizationAuctionAttemptsQuerySchema = z.strictObject({
  item: positiveBigintTextSchema.optional(),
  // 기존 strict V1 소비자의 응답 shape를 유지한다. 새 표시값을 요청한 소비자에게만 확장한다.
  includeItemLabel: z.literal("true").optional(),
  // 개인 투찰 조회가 붙을 회차의 revision을 요청한 소비자에게만 싣는다(attempt.resource 참조).
  includeRevision: z.literal("true").optional(),
  // 첫 응답 meta의 buildId·asOf를 그대로 되돌려 보내는 자리다. 활성 build가 달라졌으면 409다.
  expectedBuildId: positiveBigintTextSchema.optional(),
  asOf: instantTextSchema.optional(),
  cursor: positiveBigintTextSchema.optional(),
  // 상한 200은 pages-endpoints-load.md의 "기관 회차 ≤ 200" 점 조회 상한과 같다.
  limit: z.coerce.number().int().min(1).max(200).default(DEFAULT_ATTEMPT_LIMIT),
  opened: organizationAttemptOpenedFilterSchema.default(DEFAULT_OPENED_FILTER),
  // 하나라도 명시하면 조건 meta·행별 낙찰 방식이 포함된다. 기존 무지정 요청의 strict 응답은 유지한다.
  floorRate: organizationAttemptFloorFilterSchema.optional(),
  awardMethod: organizationAttemptAwardMethodFilterSchema.optional(),
  from: kstMonthTextSchema.optional(),
  to: kstMonthTextSchema.optional(),
}).check(periodRule, buildPinRule);

export type OrganizationAuctionAttemptsQuery = z.input<typeof organizationAuctionAttemptsQuerySchema>;

export const organizationV1Operations = {
  listAuctionAttempts: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "organizations", segments: [pathParameter("organizationId"), "auction-attempts"] },
    operationId: "listOrganizationAuctionAttempts",
    implementationOwner: "server",
    summary: "기관의 회차 요약을 최근 순으로 조회한다. 하한율·낙찰 방식은 정확한 값/all/unknown으로 구분하고,"
      + " 개찰월 기간은 양끝을 함께 지정하며 60개월을 넘을 수 없다. 새 조건을 명시하면 조건 meta와 행별 낙찰 방식을 포함한다."
      + " 다음 페이지는 첫 응답의 buildId·asOf를 되돌려 보내 같은 build와 같은 개찰 기준 시각을 이어 읽는다.",
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
      /**
       * 고정을 요청한 build가 더 이상 활성이 아니다. 소비자는 지금까지 쌓은 목록과 그 위에 붙인 개인
       * 결과를 함께 버리고 처음부터 다시 조회한다. 조용히 새 build의 페이지를 이어 주면 한 화면이 두
       * 계보의 회차를 섞어 표본 수와 계보 meta가 어느 build의 것인지 재현되지 않는다(ADR 0034).
       */
      409: { description: "고정을 요청한 mart build가 더 이상 활성이 아님", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const organizationV1OperationRegistry = createOperationRegistry([organizationV1Operations.listAuctionAttempts] as const);
