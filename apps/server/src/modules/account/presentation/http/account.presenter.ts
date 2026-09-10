/**
 * @module 책임: 계정 application record와 provider 주체를 공개 V1 응답으로 직렬화하는 순수 presenter이며, 화면
 * 표시용 라벨의 길이·빈값 정책을 여기서 정한다.
 */
import {
  accountLabelSchema,
  type AccountInitializationV1Response,
  type AccountLabel,
  type CurrentSessionV1Response,
  type MyBusinessesV1Response,
  type MyBusinessV1Response,
  type RegisteredBusiness,
  type WorkspaceSummary,
} from "@eatbid/contracts";
import { maskEmail, type AuthenticatedSubject } from "../../../../platform/auth/auth-identity";
import type { ResolvedPrincipal, ResolvedWorkspace } from "../../../../platform/auth/principal-reader";
import { bigintText, instantText } from "../../../../platform/http/wire";
import type { RegisteredBusinessRecord } from "../../application/account-repository";
import type { CurrentSessionRecord } from "../../application/get-current-session";

/**
 * 상한은 계약이 정하고 여기서 다시 적지 않는다. 두 값이 어긋나면 정상 세션이 응답 검증에서 500으로 끊긴다.
 */
const labelLimit = accountLabelSchema.shape.displayName.unwrap().maxLength ?? Number.POSITIVE_INFINITY;

/** 마지막 자리가 surrogate pair의 앞쪽이면 반쪽만 남아 대체 문자로 보이므로 한 자리를 더 버린다. */
function sliceCodeUnits(value: string, limit: number): string {
  const cut = value.slice(0, limit);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * provider가 소유한 표시 이름에는 길이 제한이 없다. 설치본 Better Auth의 `/update-user`는 계약 상한을
 * 넘는 이름도 그대로 저장하고 `auth_user.name`은 `text`다. 그 값을 응답에 그대로 실으면 로그인은
 * 정상인데 세션 조회가 500이 되어 온보딩 자체가 막힌다. 그래서 화면에 보일 형태로 줄이는 책임은
 * presentation이 지고, provider가 가진 원본 프로필과 식별자는 손대지 않는다.
 */
function toDisplayLabel(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= labelLimit) return trimmed;
  return `${sliceCodeUnits(trimmed, labelLimit - 1)}…`;
}

/**
 * 주소는 잘라내면 다른 주소가 된다. 그래서 마스킹 결과가 상한을 넘으면 줄이지 않고 표시할 수 없는 값으로
 * 둔다. 이미 형식이 아닌 주소에서도 같은 `null`이 나온다.
 */
function toMaskedEmailLabel(email: string | null): string | null {
  const masked = maskEmail(email);
  return masked !== null && masked.length <= labelLimit ? masked : null;
}

export function toAccountLabel(subject: AuthenticatedSubject): AccountLabel {
  return {
    displayName: toDisplayLabel(subject.displayName),
    maskedEmail: toMaskedEmailLabel(subject.email),
  };
}

export function toWorkspaceSummary(workspace: ResolvedWorkspace): WorkspaceSummary {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    workspaceId: bigintText(workspace.workspaceId),
    name: workspace.name,
    role: workspace.role,
  };
}

export function toRegisteredBusiness(record: RegisteredBusinessRecord): RegisteredBusiness {
  return {
    businessId: bigintText(record.registeredBusinessId),
    businessNumber: record.businessNumber,
    registeredAt: instantText(record.registeredAt),
    // 미관측과 증거 불일치를 "supplierPartyId: null"이 아니라 이름 있는 상태로 내보낸다. null은 화면에서
    // 쉽게 "참여 기록 없음"으로 읽히지만 앞은 자료 없음이고 뒤는 판정 불가다.
    supplier: record.supplier.kind === "linked"
      ? { kind: "linked", supplierPartyId: bigintText(record.supplier.supplierPartyId) }
      : { kind: record.supplier.kind },
    location: record.location === null
      ? null
      : { addressText: record.location.addressText, updatedAt: instantText(record.location.updatedAt) },
  };
}

export function toCurrentSessionResponse(record: CurrentSessionRecord): CurrentSessionV1Response {
  if (record.state === "unauthenticated") return { state: "unauthenticated" };
  const account = toAccountLabel(record.subject);
  if (record.state === "uninitialized") return { state: "uninitialized", account };
  return {
    state: "active",
    account,
    principalId: bigintText(record.principal.principalId),
    workspace: toWorkspaceSummary(record.principal.workspace),
  };
}

export function toAccountInitializationResponse(principal: ResolvedPrincipal): AccountInitializationV1Response {
  return {
    principalId: bigintText(principal.principalId),
    workspace: toWorkspaceSummary(principal.workspace),
  };
}

export function toMyBusinessesResponse(records: readonly RegisteredBusinessRecord[]): MyBusinessesV1Response {
  return { businesses: records.map(toRegisteredBusiness) };
}

export function toMyBusinessResponse(record: RegisteredBusinessRecord): MyBusinessV1Response {
  return { business: toRegisteredBusiness(record) };
}
