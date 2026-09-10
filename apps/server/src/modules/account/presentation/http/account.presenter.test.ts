import { describe, expect, test } from "bun:test";
import { meV1Operations, sessionV1Operations } from "@eatbid/contracts";
import { Temporal } from "@eatbid/domain";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import type { RegisteredBusinessRecord } from "../../application/account-repository";
import {
  toAccountInitializationResponse,
  toAccountLabel,
  toCurrentSessionResponse,
  toMyBusinessesResponse,
  toMyBusinessResponse,
} from "./account.presenter";

const sessionSchema = sessionV1Operations.getCurrentSession.successResponses[200].schema;
const businessesSchema = meV1Operations.listMyBusinesses.successResponses[200].schema;
const businessSchema = meV1Operations.registerMyBusiness.successResponses[201].schema;

const subject = { subject: "user-1", displayName: "  김철수  ", email: "chulsoo@example.com" };
const principal: ResolvedPrincipal = {
  principalId: 9_007_199_254_740_993n,
  workspace: { workspaceId: 9_007_199_254_740_995n, name: "내 워크스페이스", role: "owner" },
};
const business: RegisteredBusinessRecord = {
  registeredBusinessId: 77n,
  businessNumber: "1248100998",
  registeredAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
  supplier: { kind: "linked", supplierPartyId: 30n },
  location: { addressText: "경남 창원시", updatedAt: Temporal.Instant.from("2026-09-02T00:00:00Z") },
};

describe("계정 presenter", () => {
  test("표시 이름은 다듬어 계약 상한에 맞추고 주소는 마스킹하되 잘라내지 않는다", () => {
    expect(toAccountLabel(subject)).toEqual({ displayName: "김철수", maskedEmail: "c***@example.com" });
    expect(toAccountLabel({ ...subject, displayName: "   ", email: null })).toEqual({ displayName: null, maskedEmail: null });
    // 상한을 넘는 이름은 provider가 그대로 저장하므로 화면용으로 줄인다. 세션 조회가 500이 되면 온보딩이 막힌다.
    const long = toAccountLabel({ ...subject, displayName: "가".repeat(130) });
    expect(long.displayName).toBe(`${"가".repeat(119)}…`);
    // surrogate pair의 앞쪽 반만 남으면 대체 문자로 보이므로 한 자리를 더 버린다.
    const emoji = toAccountLabel({ ...subject, displayName: `${"a".repeat(118)}😀${"b".repeat(20)}` });
    expect(emoji.displayName).toBe(`${"a".repeat(118)}…`);
    // 주소는 잘라내면 다른 주소가 되므로 상한을 넘으면 표시하지 않는다. 형식이 아닌 주소도 같다.
    expect(toAccountLabel({ ...subject, email: `chulsoo@${"x".repeat(130)}.com` }).maskedEmail).toBeNull();
    expect(toAccountLabel({ ...subject, email: "not-an-address" }).maskedEmail).toBeNull();
  });

  test("세션 판정 셋을 각각 다른 상태로 직렬화하고 활성 세션만 principal과 워크스페이스를 싣는다", () => {
    const unauthenticated = toCurrentSessionResponse({ state: "unauthenticated" });
    const uninitialized = toCurrentSessionResponse({ state: "uninitialized", subject });
    const active = toCurrentSessionResponse({ state: "active", subject, principal });
    for (const response of [unauthenticated, uninitialized, active]) {
      expect(sessionSchema.parse(response)).toEqual(response);
    }
    expect(unauthenticated).toEqual({ state: "unauthenticated" });
    expect(uninitialized).toEqual({ state: "uninitialized", account: { displayName: "김철수", maskedEmail: "c***@example.com" } });
    expect(active).toEqual({
      state: "active",
      account: { displayName: "김철수", maskedEmail: "c***@example.com" },
      principalId: "9007199254740993",
      workspace: { workspaceId: "9007199254740995", name: "내 워크스페이스", role: "owner" },
    });
    expect(toAccountInitializationResponse(principal)).toEqual({
      principalId: "9007199254740993",
      workspace: { workspaceId: "9007199254740995", name: "내 워크스페이스", role: "owner" },
    });
  });

  test("등록 사업자의 대조 상태를 이름 있는 값으로 내보내고 위치는 갱신 시각과 함께 싣는다", () => {
    const list = toMyBusinessesResponse([business]);
    expect(businessesSchema.parse(list)).toEqual(list);
    expect(list.businesses[0]).toEqual({
      businessId: "77",
      businessNumber: "1248100998",
      registeredAt: "2026-09-01T00:00:00Z",
      supplier: { kind: "linked", supplierPartyId: "30" },
      location: { addressText: "경남 창원시", updatedAt: "2026-09-02T00:00:00Z" },
    });
    // 미관측과 증거 불일치는 supplierPartyId null이 아니라 이름 있는 상태다.
    for (const kind of ["unobserved", "evidence-conflict"] as const) {
      const single = toMyBusinessResponse({ ...business, supplier: { kind }, location: null });
      expect(businessSchema.parse(single)).toEqual(single);
      expect(single.business).toMatchObject({ supplier: { kind }, location: null });
    }
  });
});
