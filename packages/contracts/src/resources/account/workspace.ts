/** @module 책임: 워크스페이스 역할 어휘와 화면이 읽는 워크스페이스 요약의 공개 형태를 소유한다. */
import { z } from "zod";
import { positiveBigintTextSchema } from "../../atoms/identifier";

/**
 * 역할 값의 권위는 이 enum이고 `app.workspace_membership`의 check 제약이 그 사본을 강제한다.
 * 지금 필요한 구분은 "워크스페이스를 바꿀 수 있는가" 하나뿐이라 두 값으로 시작한다(ADR 0032 §3).
 */
export const workspaceRoleSchema = z.enum(["owner", "member"]).meta({ id: "WorkspaceRole" });

export const workspaceSummarySchema = z.strictObject({
  workspaceId: positiveBigintTextSchema,
  name: z.string().min(1).max(120),
  role: workspaceRoleSchema,
}).meta({ id: "WorkspaceSummary" });

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
