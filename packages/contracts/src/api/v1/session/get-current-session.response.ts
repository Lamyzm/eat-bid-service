/** @module 책임: 현재 세션 상태의 공개 응답 형태를 세 가지 구분되는 상태로 소유한다. */
import { z } from "zod";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { workspaceSummarySchema } from "../../../resources/account/workspace";

/**
 * 계정 확인에 필요한 최소값만 싣는다. 전체 이메일 주소를 응답에 넣으면 화면 캡처·오류 보고·브라우저
 * 확장까지 따라다니므로 마스킹된 형태만 내보내고 마스킹은 서버가 한다.
 */
export const accountLabelSchema = z.strictObject({
  displayName: z.string().min(1).max(120).nullable(),
  maskedEmail: z.string().min(1).max(120).nullable(),
}).meta({ id: "AccountLabel" });

/**
 * 세 상태를 하나로 합치지 않는 이유: "로그인하지 않았다"와 "로그인했지만 app 계정 초기화가 아직 안 됐다"는
 * 화면이 서로 다른 행동을 해야 하는 서로 다른 사실이다. 하나의 `authenticated: boolean`으로 줄이면
 * 초기화 미완료가 미로그인처럼 보여 사용자가 로그인을 반복하게 된다(ADR 0032 §2).
 */
export const currentSessionV1ResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unauthenticated") }),
  z.strictObject({ state: z.literal("uninitialized"), account: accountLabelSchema }),
  z.strictObject({
    state: z.literal("active"),
    account: accountLabelSchema,
    principalId: positiveBigintTextSchema,
    workspace: workspaceSummarySchema,
  }),
]).meta({ id: "CurrentSessionV1Response" });

export type AccountLabel = z.infer<typeof accountLabelSchema>;
export type CurrentSessionV1Response = z.infer<typeof currentSessionV1ResponseSchema>;
