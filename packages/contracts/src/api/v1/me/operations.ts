/** @module 책임: v1 내 계정 초기화와 등록 사업자·위치 command의 semantic route와 상태별 schema를 소유한다. */
import { z } from "zod";
import { businessNumberInputSchema } from "../../../atoms/business-number";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { workspaceSummarySchema } from "../../../resources/account/workspace";
import { createOperationRegistry, defineOperation, pathParameter } from "../../operation";
import { maxRegisteredBusinesses, registeredBusinessSchema } from "./business.resource";

const businessPathSchema = z.strictObject({ businessId: positiveBigintTextSchema });

const accountInitializationV1ResponseSchema = z.strictObject({
  principalId: positiveBigintTextSchema,
  workspace: workspaceSummarySchema,
}).meta({ id: "AccountInitializationV1Response" });

const myBusinessesV1ResponseSchema = z.strictObject({
  businesses: z.array(registeredBusinessSchema).max(maxRegisteredBusinesses),
}).meta({ id: "MyBusinessesV1Response" });

const myBusinessV1ResponseSchema = z.strictObject({
  business: registeredBusinessSchema,
}).meta({ id: "MyBusinessV1Response" });

const registerMyBusinessCommandSchema = z.strictObject({
  businessNumber: businessNumberInputSchema,
}).meta({ id: "RegisterMyBusinessCommand" });

const setMyBusinessLocationCommandSchema = z.strictObject({
  addressText: z.string().trim().min(1).max(200),
}).meta({ id: "SetMyBusinessLocationCommand" });

/**
 * 401과 403을 나눠 두는 이유: 401은 유효한 세션이 없다는 뜻이라 재로그인이 답이고, 403은 세션은 유효하지만
 * 이 요청이 허용되지 않는다는 뜻이다. 둘을 401로 합치면 초기화 미완료나 역할 부족인 사용자가 로그인을
 * 반복한다. 어느 쪽인지는 `getCurrentSession`이 상태로 말한다.
 *
 * 403이 실제로 나오는 경로는 넷이다. 신뢰하지 않는 `Origin`의 상태 변경, 계정 초기화 미완료, 남의
 * 워크스페이스 자원, `owner`가 아닌 구성원의 쓰기. 응답 본문은 어느 쪽인지 적지 않지만 계약이 이 status를
 * 숨기면 소비자가 처리할 수 없는 실패가 된다.
 */
const forbiddenProblem = {
  403: {
    description: "신뢰하지 않는 Origin, 계정 초기화 미완료, 남의 워크스페이스 자원 또는 owner 권한 부족",
    schema: problemDetailsSchema,
  },
} as const;

const sessionProblems = {
  ...unauthenticatedProblemResponse,
  500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
  503: { description: "데이터베이스 또는 인증 의존성을 사용할 수 없음", schema: problemDetailsSchema },
} as const;

const principalProblems = { ...sessionProblems, ...forbiddenProblem } as const;

const businessProblems = {
  400: { description: "요청 본문 또는 사업자번호 형식이 유효하지 않음", schema: problemDetailsSchema },
  ...principalProblems,
  404: { description: "등록된 사업자를 찾을 수 없음", schema: problemDetailsSchema },
} as const;

export const meV1Operations = {
  /**
   * app 계정 생성은 provider hook이 아니라 이 명시적 command가 한다. pinned Better Auth 1.7.2의
   * `user.create.after` hook은 provider transaction이 commit된 뒤 실행되므로 provider 저장과 app 저장을
   * 한 원자 단위로 묶을 수 없다. hook에 걸면 hook 실패가 계정 없는 로그인으로 남고 사용자는 재로그인으로도
   * 복구하지 못한다. 같은 command를 다시 부르는 것이 복구 경로다(ADR 0032 §2).
   */
  initializeCurrentAccount: defineOperation({
    method: "post",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["initialization"] },
    operationId: "initializeCurrentAccount",
    implementationOwner: "server",
    summary: "유효한 provider 세션으로 principal·identity·개인 워크스페이스를 멱등하게 만든다."
      + " 이미 초기화된 계정에는 같은 관계를 그대로 돌려준다.",
    tags: ["account"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "계정 초기화 완료", schema: accountInitializationV1ResponseSchema },
    },
    // principal 부재를 전제하지 않는 유일한 command이지만, 상태를 바꾸므로 Origin 거절 403은 여기도 있다.
    problemResponses: { ...sessionProblems, ...forbiddenProblem },
  }),
  listMyBusinesses: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["businesses"] },
    operationId: "listMyBusinesses",
    implementationOwner: "server",
    summary: "내 워크스페이스가 등록한 사업자를 원본 대조 결과·위치와 함께 조회한다.",
    tags: ["account"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "등록 사업자 조회 성공", schema: myBusinessesV1ResponseSchema },
    },
    problemResponses: principalProblems,
  }),
  registerMyBusiness: defineOperation({
    method: "post",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["businesses"] },
    operationId: "registerMyBusiness",
    implementationOwner: "server",
    summary: "사업자등록번호를 내 분석 기준으로 등록한다. 워크스페이스 owner만 등록할 수 있고, 원본에서"
      + " 아직 관측되지 않은 번호도 미연결로 보존하며 다른 워크스페이스의 등록과 충돌하지 않는다.",
    tags: ["account"],
    pathSchema: z.undefined(),
    querySchema: z.undefined(),
    bodySchema: registerMyBusinessCommandSchema,
    successResponses: {
      201: { description: "사업자 등록 성공", schema: myBusinessV1ResponseSchema },
    },
    problemResponses: {
      400: businessProblems[400],
      ...principalProblems,
      // 같은 워크스페이스가 같은 번호를 두 번 등록할 때만 충돌이다. 다른 워크스페이스의 등록은 충돌이 아니다.
      // 등록 상한을 넘긴 요청도 같은 status다. 둘 다 "이 워크스페이스는 이 등록을 더 만들 수 없다"이다.
      409: {
        description: `이 워크스페이스에 이미 등록된 사업자이거나 활성 등록이 ${maxRegisteredBusinesses}건 상한에 도달함`,
        schema: problemDetailsSchema,
      },
    },
  }),
  setMyBusinessLocation: defineOperation({
    method: "put",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["businesses", pathParameter("businessId"), "location"] },
    operationId: "setMyBusinessLocation",
    implementationOwner: "server",
    summary: "등록한 사업자의 사업장 위치를 사용자가 적은 주소 문장으로 저장한다. 워크스페이스 owner만"
      + " 바꿀 수 있고 해석된 행정구역 코드나 좌표로 바꾸지 않는다.",
    tags: ["account"],
    pathSchema: businessPathSchema,
    querySchema: z.undefined(),
    bodySchema: setMyBusinessLocationCommandSchema,
    successResponses: {
      200: { description: "위치 저장 성공", schema: myBusinessV1ResponseSchema },
    },
    problemResponses: businessProblems,
  }),
  clearMyBusinessLocation: defineOperation({
    method: "delete",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["businesses", pathParameter("businessId"), "location"] },
    operationId: "clearMyBusinessLocation",
    implementationOwner: "server",
    summary: "등록한 사업자의 위치를 미설정으로 되돌린다. 워크스페이스 owner만 바꿀 수 있고 미설정은"
      + " 빈 문자열이 아니라 값이 없는 상태다.",
    tags: ["account"],
    pathSchema: businessPathSchema,
    querySchema: z.undefined(),
    bodySchema: z.undefined(),
    successResponses: {
      200: { description: "위치 삭제 성공", schema: myBusinessV1ResponseSchema },
    },
    problemResponses: businessProblems,
  }),
} as const;

export const meV1OperationRegistry = createOperationRegistry([
  meV1Operations.initializeCurrentAccount,
  meV1Operations.listMyBusinesses,
  meV1Operations.registerMyBusiness,
  meV1Operations.setMyBusinessLocation,
  meV1Operations.clearMyBusinessLocation,
] as const);

export {
  accountInitializationV1ResponseSchema,
  myBusinessesV1ResponseSchema,
  myBusinessV1ResponseSchema,
  registerMyBusinessCommandSchema,
  setMyBusinessLocationCommandSchema,
};

export type AccountInitializationV1Response = z.infer<typeof accountInitializationV1ResponseSchema>;
export type MyBusinessesV1Response = z.infer<typeof myBusinessesV1ResponseSchema>;
export type MyBusinessV1Response = z.infer<typeof myBusinessV1ResponseSchema>;

/**
 * 입력과 출력 타입을 따로 내보낸다. 사업자번호 command는 사용자 표기를 받아 canonical 숫자로 정규화하므로
 * 보내는 쪽이 아는 타입과 서버가 검증 뒤 다루는 타입이 같지 않다. 한 이름으로 합치면 controller가 정규화
 * 이전 값을 정규화된 값처럼 다룬다.
 */
export type RegisterMyBusinessCommand = z.input<typeof registerMyBusinessCommandSchema>;
export type RegisterMyBusinessCommandInput = z.output<typeof registerMyBusinessCommandSchema>;
export type SetMyBusinessLocationCommand = z.input<typeof setMyBusinessLocationCommandSchema>;
export type SetMyBusinessLocationCommandInput = z.output<typeof setMyBusinessLocationCommandSchema>;
