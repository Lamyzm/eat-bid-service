/** @module 책임: 계정 application record를 공개 V1 응답 형태로 직렬화하는 변환만 소유한다. */
import {
  instantCodec,
  type RegisteredBusiness,
  type WorkspaceSummary,
} from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";
import { z } from "zod";
import type { ResolvedWorkspace } from "../../../platform/auth/principal-reader";
import type { RegisteredBusinessRecord } from "./account-repository";

function instantText(value: Temporal.Instant): string {
  return z.encode(instantCodec, value);
}

export function toWorkspaceSummary(workspace: ResolvedWorkspace): WorkspaceSummary {
  return {
    // PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다.
    workspaceId: workspace.workspaceId.toString(10),
    name: workspace.name,
    role: workspace.role,
  };
}

export function toRegisteredBusiness(record: RegisteredBusinessRecord): RegisteredBusiness {
  return {
    businessId: record.registeredBusinessId.toString(10),
    businessNumber: record.businessNumber,
    registeredAt: instantText(record.registeredAt),
    // 미관측을 "supplierPartyId: null"이 아니라 이름 있는 상태로 내보낸다. null은 화면에서 쉽게
    // "참여 기록 없음"으로 읽히지만 이것은 자료 없음이다.
    supplier: record.supplierPartyId === null
      ? { kind: "unobserved" }
      : { kind: "linked", supplierPartyId: record.supplierPartyId.toString(10) },
    location: record.location === null
      ? null
      : { addressText: record.location.addressText, updatedAt: instantText(record.location.updatedAt) },
  };
}
