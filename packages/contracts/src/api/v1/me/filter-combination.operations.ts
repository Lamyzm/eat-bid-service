/** @module 책임: v1 저장된 조건 조합의 조회·저장·삭제와 조합 건수 한 번 세기 operation의 semantic route와 상태별 schema를 소유한다. */
import { z } from "zod";

import { canonicalMoneyAmountSchema } from "../../../atoms/decimal";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { martBuildLineageSchema } from "../../../values/mart-lineage";
import { createOperationRegistry, defineOperation, pathParameter } from "../../operation";
import {
  eligibilityAreaFilterSchema,
  itemsFilterSchema,
  searchTextSchema,
  openAuctionStateSchema,
  sigunguFilterSchema,
} from "../auctions/list-open-auctions.query";
import {
  defaultCombinationCountSchema,
  filterCombinationSchema,
  maxFilterCombinations,
  savedCombinationCountSchema,
  saveFilterCombinationCommandSchema,
} from "./filter-combination.resource";

const combinationPathSchema = z.strictObject({ filterCombinationId: positiveBigintTextSchema });

const myFilterCombinationsV1ResponseSchema = z.strictObject({
  combinations: z.array(filterCombinationSchema).max(maxFilterCombinations),
}).meta({ id: "MyFilterCombinationsV1Response" });

const myFilterCombinationV1ResponseSchema = z.strictObject({
  combination: filterCombinationSchema,
}).meta({ id: "MyFilterCombinationV1Response" });

/**
 * 건수 조회가 받는 조건이다. 기본 넷 중 둘(`noBids`·`itemUnknownIncluded`)이 **지금 화면 조건에서의
 * 이동**이라 그 조건을 함께 받아야 센다. 나머지 둘은 워크스페이스의 관심 지역에서만 파생한다.
 *
 * 날짜 축을 받지 않는다. 조합은 그 시점의 집합을 가리킬 뿐이고, 날짜로 좁힌 수를 조합 옆에 적으면
 * 사용자가 조합을 눌렀을 때의 수와 달라진다.
 */
export const filterCombinationCountsQuerySchema = z.strictObject({
  state: openAuctionStateSchema.default("open"),
  sido: positiveBigintTextSchema.optional(),
  sigungu: sigunguFilterSchema.optional(),
  eligibilityArea: eligibilityAreaFilterSchema.optional(),
  items: itemsFilterSchema.optional(),
  // 검색도 "지금 화면 조건"이다. `noBids`·`itemUnknownIncluded` 링크가 검색어를 이어 가므로 그 수도 검색
  // 안에서 세야 누르면 되는 수가 된다. 저장 조합·관심 지역 둘은 검색을 버리므로 이 값이 닿지 않는다(EAT-247).
  q: searchTextSchema.optional(),
  baseAmountMin: canonicalMoneyAmountSchema.optional(),
  baseAmountMax: canonicalMoneyAmountSchema.optional(),
}).meta({ id: "FilterCombinationCountsQuery" });

/**
 * 조합 아홉의 건수를 **한 번의 요청**으로 낸다. 조합마다 요약을 부르면 아홉 번이고, 그 아홉이 서로 다른
 * 시각을 볼 수 있다. `meta.asOf`와 build 계보가 아홉 수 전부의 코호트다(AGENTS 7).
 */
const myFilterCombinationCountsV1ResponseSchema = z.strictObject({
  defaults: z.array(defaultCombinationCountSchema).max(4),
  saved: z.array(savedCombinationCountSchema).max(maxFilterCombinations),
  meta: z.strictObject({
    asOf: instantTextSchema,
    openAuctionSnapshotBuild: martBuildLineageSchema,
  }),
}).meta({ id: "MyFilterCombinationCountsV1Response" });

const combinationProblems = {
  ...unauthenticatedProblemResponse,
  403: {
    description: "신뢰하지 않는 Origin, 계정 초기화 미완료 또는 남의 워크스페이스 자원",
    schema: problemDetailsSchema,
  },
  500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
  503: { description: "데이터베이스 또는 인증 의존성을 사용할 수 없음", schema: problemDetailsSchema },
} as const;

export const myFilterCombinationV1Operations = {
  listMyFilterCombinations: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["filter-combinations"] },
    operationId: "listMyFilterCombinations",
    implementationOwner: "server",
    summary: "내 워크스페이스가 저장한 조건 조합을 만든 순서대로 조회한다."
      + " 기본 조합은 저장되지 않으므로 여기 없다.",
    tags: ["account"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "저장된 조합 조회 성공", schema: myFilterCombinationsV1ResponseSchema },
    },
    problemResponses: combinationProblems,
  }),
  /**
   * **건수는 `:filterCombinationId`보다 앞에 둔다.** 뒤에 두면 고정 segment가 path parameter에 먹혀
   * `counts`라는 id의 조합을 찾는 요청이 되고 id 형식 검증에서 400이 난다. Nest handler 순서와 이
   * registry 순서가 같아야 한다.
   */
  countMyFilterCombinations: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["filter-combinations", "counts"] },
    operationId: "countMyFilterCombinations",
    implementationOwner: "server",
    summary: "기본 넷과 저장된 조합의 건수를 한 번의 요청으로 센다."
      + " 기본 넷은 관심 지역과 지금 조건에서 파생하며 저장되지 않는다.",
    tags: ["account"],
    pathSchema: z.undefined(),
    querySchema: filterCombinationCountsQuerySchema,
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "조합 건수 조회 성공", schema: myFilterCombinationCountsV1ResponseSchema },
    },
    problemResponses: {
      400: { description: "query가 유효하지 않거나 시군구만 보냄", schema: problemDetailsSchema },
      ...combinationProblems,
    },
  }),
  saveMyFilterCombination: defineOperation({
    method: "post",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["filter-combinations"] },
    operationId: "saveMyFilterCombination",
    implementationOwner: "server",
    summary: `지금 조건에 이름을 붙여 저장한다. 워크스페이스당 ${maxFilterCombinations}개가 상한이고`
      + " 같은 이름을 두 번 저장할 수 없다.",
    tags: ["account"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: saveFilterCombinationCommandSchema,
    successResponses: {
      201: { description: "조합 저장 성공", schema: myFilterCombinationV1ResponseSchema },
    },
    problemResponses: {
      400: {
        description: "요청 본문이 유효하지 않거나 시도 없이 시군구만 보냄",
        schema: problemDetailsSchema,
      },
      // 상한 초과와 이름 중복을 409로 답한다. 요청 자체는 유효하고 지금 저장 상태와 충돌한 것이다.
      409: {
        description: `이미 ${maxFilterCombinations}개를 저장했거나 같은 이름이 있음`,
        schema: problemDetailsSchema,
      },
      ...combinationProblems,
    },
  }),
  deleteMyFilterCombination: defineOperation({
    method: "delete",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["filter-combinations", pathParameter("filterCombinationId")] },
    operationId: "deleteMyFilterCombination",
    implementationOwner: "server",
    summary: "저장한 조합 하나를 지운다. 남의 워크스페이스 조합은 403이다.",
    tags: ["account"],
    pathSchema: combinationPathSchema,
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      204: { description: "조합 삭제 성공", schema: z.undefined() },
    },
    problemResponses: {
      404: { description: "그 id의 조합이 없음", schema: problemDetailsSchema },
      ...combinationProblems,
    },
  }),
} as const;

export const myFilterCombinationV1OperationRegistry = createOperationRegistry([
  myFilterCombinationV1Operations.listMyFilterCombinations,
  myFilterCombinationV1Operations.countMyFilterCombinations,
  myFilterCombinationV1Operations.saveMyFilterCombination,
  myFilterCombinationV1Operations.deleteMyFilterCombination,
] as const);

export {
  myFilterCombinationCountsV1ResponseSchema,
  myFilterCombinationsV1ResponseSchema,
  myFilterCombinationV1ResponseSchema,
};

export type MyFilterCombinationsV1Response = z.infer<typeof myFilterCombinationsV1ResponseSchema>;
export type MyFilterCombinationV1Response = z.infer<typeof myFilterCombinationV1ResponseSchema>;
export type MyFilterCombinationCountsV1Response = z.infer<typeof myFilterCombinationCountsV1ResponseSchema>;
export type FilterCombinationCountsQuery = z.output<typeof filterCombinationCountsQuerySchema>;
