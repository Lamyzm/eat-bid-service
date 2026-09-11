import { describe, expect, test } from "bun:test";

import { publicHttpOperationRegistry } from "../../registry";
import {
  myRegionPreferenceV1Operations,
  myRegionPreferenceV1ResponseSchema,
  putMyRegionPreferenceCommandSchema,
} from "./region-preference.operations";

const read = myRegionPreferenceV1Operations.getMyRegionPreference;
const replace = myRegionPreferenceV1Operations.putMyRegionPreference;

const area = (codeValueId: string, code: string, label: string | null) => ({
  codeValueId,
  code,
  scheme: "eat:eligibility-area",
  label,
});

describe("내 관심 지역 operation 계약", () => {
  test("공개 registry가 두 operation을 각각 한 번만 갖는다", () => {
    for (const operationId of ["getMyRegionPreference", "putMyRegionPreference"]) {
      const found = publicHttpOperationRegistry.filter((operation) => operation.operationId === operationId);
      expect(found.length).toBe(1);
      expect(found[0]?.implementationOwner).toBe("server");
    }
  });

  test("읽기와 교체가 같은 me 자원 경로를 쓴다", () => {
    expect(read.openApiPath).toBe("/api/v1/me/region-preference");
    expect(replace.openApiPath).toBe("/api/v1/me/region-preference");
    expect(read.method).toBe("get");
    expect(replace.method).toBe("put");
  });

  test("확인하지 않은 워크스페이스는 빈 목록과 null 확인 시각으로 표현된다", () => {
    const parsed = myRegionPreferenceV1ResponseSchema.safeParse({
      preference: { areas: [], confirmedAt: null },
    });
    expect(parsed.success).toBe(true);
    // 코드를 하나도 고르지 않고 확인만 한 상태는 미설정과 다른 값이다.
    expect(myRegionPreferenceV1ResponseSchema.safeParse({
      preference: { areas: [], confirmedAt: "2026-09-11T00:00:00Z" },
    }).success).toBe(true);
    expect(myRegionPreferenceV1ResponseSchema.safeParse({
      preference: {
        areas: [area("9101", "15000", "경남/전체"), area("9102", "15653", "경남/김해시")],
        confirmedAt: "2026-09-11T00:00:00Z",
      },
    }).success).toBe(true);
  });

  test("교체 command는 빈 목록을 받고 상한을 넘긴 목록과 잘못된 id를 거부한다", () => {
    expect(putMyRegionPreferenceCommandSchema.safeParse({ codeValueIds: [] }).success).toBe(true);
    expect(putMyRegionPreferenceCommandSchema.safeParse({ codeValueIds: ["9102", "9101"] }).success).toBe(true);
    expect(putMyRegionPreferenceCommandSchema.safeParse({ codeValueIds: ["0"] }).success).toBe(false);
    // 부분 갱신 command를 만들지 않으므로 다른 key는 받지 않는다.
    expect(putMyRegionPreferenceCommandSchema.safeParse({ add: ["9102"] }).success).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, index) => String(index + 1));
    expect(putMyRegionPreferenceCommandSchema.safeParse({ codeValueIds: tooMany }).success).toBe(false);
  });

  test("교체는 owner 권한 부족과 미로그인을 다른 status로 나눈다", () => {
    expect(read.problemStatuses).toEqual([401, 403, 500, 503]);
    expect(replace.problemStatuses).toEqual([400, 401, 403, 500, 503]);
  });
});
