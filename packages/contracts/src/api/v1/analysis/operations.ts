/** @module 책임: v1 분석 시간축 조회의 semantic route·공통 필터 query·상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";

import { kstDateTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { bidRateTextSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../../operation";
import { analysisDateBasisSchema, analysisRegionSchemeSchema } from "./filter.resource";
import { analysisTimeSeriesV1ResponseSchema } from "./find-analysis-time-series.response";

/**
 * 기간 상한이다. 사용자는 5년까지 좁혀 보고 싶어 하므로 달 수가 아니라 날 수로 닫는다 — 달로 닫으면
 * 월 중간을 고른 요청이 상한 계산에서 한 달씩 흔들린다. 윤년을 포함한 5년이 1,827일이라 여유를 둔다.
 */
const MAX_PERIOD_DAYS = 1_900;

type TimeSeriesQuery = {
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
  targetItemCodeValueId?: string;
};

function reject(ctx: z.core.ParsePayload<TimeSeriesQuery>, path: string, message: string): void {
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
function comparisonAxisRule(ctx: z.core.ParsePayload<TimeSeriesQuery>): void {
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
function periodRule(ctx: z.core.ParsePayload<TimeSeriesQuery>): void {
  const days = dayOrdinal(ctx.value.to) - dayOrdinal(ctx.value.from);
  if (days < 0) reject(ctx, "to", "기간은 시간순이어야 합니다.");
  else if (days + 1 > MAX_PERIOD_DAYS) reject(ctx, "to", `기간은 ${MAX_PERIOD_DAYS}일을 넘을 수 없습니다.`);
}

/**
 * 명단 범위는 양끝 포함이고 한쪽 null은 그쪽 제한 없음이다. `0~0`은 전체와 다르다 — 명단이 0인 판만
 * 보겠다는 뜻이라 조건을 안 건 것과 같은 수가 나오면 안 된다(PDR-0006).
 */
function listCountRule(ctx: z.core.ParsePayload<TimeSeriesQuery>): void {
  const { listCountMin, listCountMax } = ctx.value;
  if (listCountMin === undefined || listCountMax === undefined) return;
  if (listCountMin > listCountMax) reject(ctx, "listCountMax", "명단 범위는 최소가 최대보다 클 수 없습니다.");
}

const analysisTimeSeriesQuerySchema = z.strictObject({
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
  listCountMin: nonNegativeCountSchema.optional(),
  listCountMax: nonNegativeCountSchema.optional(),
  // 품목은 기관에만 적용한다. 비교군은 언제나 전체 품목이다(PDR-0006).
  targetItemCodeValueId: positiveBigintTextSchema.optional(),
})
  .check(comparisonAxisRule)
  .check(periodRule)
  .check(listCountRule);

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
    tags: ["procurement"],
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
} as const;

export const analysisV1OperationRegistry = createOperationRegistry([
  analysisV1Operations.findTimeSeries,
] as const);

export type AnalysisTimeSeriesQuery = z.infer<typeof analysisTimeSeriesQuerySchema>;
