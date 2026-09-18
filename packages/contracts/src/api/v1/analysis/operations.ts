/** @module 책임: v1 분석 시간축 조회의 semantic route·공통 필터 query·상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { bidRateTextSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { AUCTION_ITEM_ATOMS, auctionItemAtomSchema } from "../../../values/auction-item";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../../operation";
import { analysisDateBasisSchema, analysisRegionSchemeSchema } from "./filter.resource";
import { analysisConditionOptionsV1ResponseSchema } from "./condition-options.response";
import { analysisTimeSeriesV1ResponseSchema } from "./find-analysis-time-series.response";

/**
 * 기간 상한이다. 사용자는 5년까지 좁혀 보고 싶어 하므로 달 수가 아니라 날 수로 닫는다 — 달로 닫으면
 * 월 중간을 고른 요청이 상한 계산에서 한 달씩 흔들린다. 윤년을 포함한 5년이 1,827일이라 여유를 둔다.
 */
const MAX_PERIOD_DAYS = 1_900;

type AnalysisConditionQuery = {
  organizationId: string;
  excludeAttemptId?: string;
  from: string;
  to: string;
  dateBasis: z.infer<typeof analysisDateBasisSchema>;
  comparisonScope: "national" | "region";
  comparisonRegionScheme?: z.infer<typeof analysisRegionSchemeSchema>;
  comparisonRegionCodeValueId?: string;
  floorRate: string;
  awardMethodCodeValueId: string;
  listCountMin?: number;
  listCountMax?: number;
  items?: readonly z.infer<typeof auctionItemAtomSchema>[];
  itemUnknown?: "include" | "only";
  overlayOrganizationIds?: readonly string[];
};

function reject(
  ctx: z.core.ParsePayload<AnalysisConditionQuery>,
  path: string,
  message: string,
): void {
  ctx.issues.push({ code: "custom", message, input: ctx.value, path: [path] });
}

/**
 * `YYYY-MM-DD`를 달력일 번호로 바꾼다. 기간 길이를 세는 데만 쓰므로 기준점이 어디든 상관없고 차이만
 * 맞으면 된다.
 *
 * `Date`도 `Temporal`도 쓰지 않는 이유는 이 파일이 portable 계약 그래프이기 때문이다 — 브라우저로 가는
 * 그래프에 시간 구현체를 섞지 않는다(AGENTS 17). 윤년은 3월을 해의 시작으로 옮겨 2월 29일을 해의 마지막
 * 날로 만드는 잘 알려진 셈법으로 처리한다. 월 단위로 세지 않는 이유는 월 중간을 고른 요청이 상한 계산에서
 * 한 달씩 흔들리기 때문이다.
 */
function dayOrdinal(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra;
}

/**
 * 비교 모집단과 그 축의 짝이다. 전국은 지역을 갖지 않고, 지역은 **체계와 코드값을 함께** 가져야 한다.
 *
 * 체계를 따로 받는 이유는 eaT 공고지역의 시도와 시군구가 **서로 다른 code scheme**이기 때문이다.
 * 코드값 id만 받으면 같은 숫자가 어느 체계의 구역인지 말하지 않고, 그 순간 화면이 다른 체계의 지역을
 * 이 조회의 지역으로 읽는다(AGENTS 6, ADR 0035).
 */
function comparisonAxisRule<Query extends AnalysisConditionQuery>(ctx: z.core.ParsePayload<Query>): void {
  const { comparisonScope, comparisonRegionScheme, comparisonRegionCodeValueId } = ctx.value;
  if (comparisonScope === "national") {
    if (comparisonRegionScheme !== undefined) reject(ctx, "comparisonRegionScheme", "전국 비교는 지역 축을 갖지 않습니다.");
    if (comparisonRegionCodeValueId !== undefined) reject(ctx, "comparisonRegionCodeValueId", "전국 비교는 지역 축을 갖지 않습니다.");
    return;
  }
  if (comparisonRegionScheme === undefined) reject(ctx, "comparisonRegionScheme", "지역 비교는 코드 체계를 함께 지정해야 합니다.");
  if (comparisonRegionCodeValueId === undefined) reject(ctx, "comparisonRegionCodeValueId", "지역 비교는 지역 코드값을 함께 지정해야 합니다.");
}

/** 기간은 양끝 포함 KST 달력일이고 역전될 수 없다. 상한이 있어야 응답 크기와 DB 스캔 행 수가 닫힌다. */
function periodRule<Query extends AnalysisConditionQuery>(ctx: z.core.ParsePayload<Query>): void {
  const days = dayOrdinal(ctx.value.to) - dayOrdinal(ctx.value.from);
  if (days < 0) reject(ctx, "to", "기간은 시간순이어야 합니다.");
  else if (days + 1 > MAX_PERIOD_DAYS) reject(ctx, "to", `기간은 ${MAX_PERIOD_DAYS}일을 넘을 수 없습니다.`);
}

/**
 * 명단 범위는 양끝 포함이고 한쪽 null은 그쪽 제한 없음이다. `0~0`은 전체와 다르다 — 명단이 0인 판만
 * 보겠다는 뜻이라 조건을 안 건 것과 같은 수가 나오면 안 된다(PDR-0006).
 */
function listCountRule<Query extends AnalysisConditionQuery>(ctx: z.core.ParsePayload<Query>): void {
  const { listCountMin, listCountMax } = ctx.value;
  if (listCountMin === undefined || listCountMax === undefined) return;
  if (listCountMin > listCountMax) reject(ctx, "listCountMax", "명단 범위는 최소가 최대보다 클 수 없습니다.");
}

/**
 * `only`는 품목을 말하지 않은 회차만 보겠다는 뜻이라 원자와 함께 올 수 없다. 둘을 함께 받으면 서버가
 * "고른 원자" 아니면 "미확인"을 골라야 하고, 어느 쪽을 골라도 화면이 말한 조건과 다른 집합이 나온다.
 */
function itemRule<Query extends AnalysisConditionQuery>(ctx: z.core.ParsePayload<Query>): void {
  if (ctx.value.itemUnknown === "only" && ctx.value.items !== undefined) {
    reject(ctx, "items", "품목 미확인만 보는 요청에는 품목 원자를 함께 지정할 수 없습니다.");
  }
}

/**
 * 명단 경계는 query 문자열로 온다. 응답 쪽 개수 atom은 이미 JSON 정수라 그대로 쓰면 `listCountMin=12`가
 * 형식 오류로 튕긴다(2026-09-18 dev 실측). 범위는 응답 atom과 같은 PostgreSQL integer 범위로 닫는다.
 */
const listCountQuerySchema = z.coerce.number().int().nonnegative().max(2_147_483_647);

/**
 * 품목 원자 목록이다. query string은 값 하나와 값 여럿을 구분하지 못하므로 파싱 직전에 한 번만 배열로
 * 편다 — 오늘 화면의 `itemsFilterSchema`와 같은 이유, 같은 형태다.
 */
const analysisItemsQuerySchema = z.preprocess(
  (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
  z.array(auctionItemAtomSchema).min(1).max(AUCTION_ITEM_ATOMS.length),
);

/**
 * 시간축 조회와 조건 사전 조회가 **같은 코호트**를 말하려면 같은 조건을 받아야 한다. 한쪽에만 있는
 * 축이 생기는 순간 조건 막대의 건수와 그림의 표본 수가 서로 다른 집합을 세게 된다. 그래서 공통 필드는
 * 여기 한 번만 선언하고 두 schema가 나눠 쓴다.
 */
const analysisConditionFields = {
  organizationId: positiveBigintTextSchema,
  // 지금 보고 있는 공고의 회차다. 두 집단 모두에서 뺀다 — 자기 자신을 비교군에 넣으면 그 점이 자기
  // 분포를 만든다(PDR-0006).
  excludeAttemptId: positiveBigintTextSchema.optional(),
  from: kstDateTextSchema,
  to: kstDateTextSchema,
  dateBasis: analysisDateBasisSchema,
  comparisonScope: z.enum(["national", "region"]),
  comparisonRegionScheme: analysisRegionSchemeSchema.optional(),
  comparisonRegionCodeValueId: positiveBigintTextSchema.optional(),
  // 하한율은 정의상 0~100이라 관측 사정률과 다른 atom을 쓴다. 미확인 값을 90으로 추정하지 않는다.
  floorRate: bidRateTextSchema,
  awardMethodCodeValueId: positiveBigintTextSchema,
  listCountMin: listCountQuerySchema.optional(),
  listCountMax: listCountQuerySchema.optional(),
  // 품목은 기관·비교군·겹쳐 찍은 기관에 같게 걸린다(PDR-0007). 값은 오늘 화면과 같은 원자다.
  items: analysisItemsQuerySchema.optional(),
  /**
   * 품목을 말하지 않은 회차를 어떻게 다룰지다. `include`는 고른 원자와 **함께**, `only`는 그것만이다.
   * 둘 다 없으면 원자 조건만 걸린다. 전체(조건 없음)는 `items`도 이 값도 없는 상태다.
   */
  itemUnknown: z.enum(["include", "only"]).optional(),
  /**
   * 겹쳐 찍을 기관이다. 값 하나와 값 여럿을 query string이 구분하지 못하므로 품목과 같은 방식으로 한 번만
   * 배열로 편다. 모집단을 바꾸지 않으므로 이 값이 달라져도 표본 수는 그대로다.
   */
  overlayOrganizationIds: z.preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(positiveBigintTextSchema).min(1).max(6),
  ).optional(),
} as const;

const analysisTimeSeriesQuerySchema = z.strictObject(analysisConditionFields)
  .check(comparisonAxisRule)
  .check(periodRule)
  .check(listCountRule)
  .check(itemRule);

/**
 * 조건 사전은 같은 조건에 **두 가지만** 더 받는다. `sido`는 그 시도의 시군구를 함께 내라는 뜻이고,
 * `organizationQuery`는 고른 지역 안에서 기관 이름을 좁히는 말이다. 검색어가 `strpos`인 이유는 오늘
 * 화면과 같다 — 사용자 입력에 `like` 메타문자를 열지 않는다.
 */
const analysisConditionOptionsQuerySchema = z.strictObject({
  ...analysisConditionFields,
  sido: positiveBigintTextSchema.optional(),
  organizationQuery: z.string().trim().min(1).max(64).optional(),
})
  .check(comparisonAxisRule)
  .check(periodRule)
  .check(listCountRule)
  .check(itemRule);

export const analysisV1Operations = {
  findTimeSeries: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "analysis", segments: ["time-series"] },
    operationId: "findAnalysisTimeSeries",
    implementationOwner: "server",
    summary: "한 기관의 실제 낙찰점과 같은 조건의 지역·전국 관측을 시간축에서 함께 조회한다."
      + " 기관 점과 비교군을 한 응답으로 내며, 넓은 범위의 비교군은 실제 점이 아니라 관측 밀도로 온다."
      + " 기간은 양끝 포함 KST 달력일이고 명단 범위도 양끝 포함이다. 지역 비교는 코드 체계와 코드값을 함께 지정한다.",
    tags: ["공고와 분석"],
    pathSchema: z.strictObject({}),
    querySchema: analysisTimeSeriesQuerySchema,
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "분석 시간축 조회 성공. 자료가 준비되지 않은 상태도 200이며 meta가 사유를 말한다", schema: analysisTimeSeriesV1ResponseSchema },
    },
    problemResponses: {
      400: {
        description: "query가 유효하지 않거나 비교 모집단과 지역 축의 짝, 기간 상한·순서, 명단 범위 순서를 어김",
        schema: problemDetailsSchema,
      },
      ...unauthenticatedProblemResponse,
      403: { description: "이 분석을 볼 수 있는 인가가 없음", schema: problemDetailsSchema },
      404: { description: "요청한 기관·지역 코드값·낙찰 방식 코드값을 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
  findConditionOptions: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "analysis", segments: ["condition-options"] },
    operationId: "findAnalysisConditionOptions",
    implementationOwner: "server",
    summary: "지금 조건에서 고를 수 있는 비교 지역·기관·품목과 그 건수를 조회한다."
      + " 지역과 품목의 건수는 그 축 하나만 푼 집합에서 세므로 \"이것으로 바꾸면 몇 건이 되나\"를 말한다."
      + " 기관은 고른 비교 지역 안에서만 세고 검색어로 좁힌다.",
    tags: ["공고와 분석"],
    pathSchema: z.strictObject({}),
    querySchema: analysisConditionOptionsQuerySchema,
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "조건 사전 조회 성공", schema: analysisConditionOptionsV1ResponseSchema },
    },
    problemResponses: {
      400: {
        description: "query가 유효하지 않거나 비교 모집단과 지역 축의 짝, 기간 상한·순서, 명단 범위 순서를 어김",
        schema: problemDetailsSchema,
      },
      ...unauthenticatedProblemResponse,
      403: { description: "이 분석을 볼 수 있는 인가가 없음", schema: problemDetailsSchema },
      404: { description: "요청한 기관·지역 코드값을 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const analysisV1OperationRegistry = createOperationRegistry([
  analysisV1Operations.findTimeSeries,
  analysisV1Operations.findConditionOptions,
] as const);

export type AnalysisTimeSeriesQuery = z.infer<typeof analysisTimeSeriesQuerySchema>;
export type AnalysisConditionOptionsQuery = z.infer<typeof analysisConditionOptionsQuerySchema>;
