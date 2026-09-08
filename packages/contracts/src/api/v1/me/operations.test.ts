import { describe, expect, test } from "bun:test";

import { publicHttpOperationRegistry } from "../../registry";
import { registeredBusinessSchema } from "./business.resource";
import {
  meV1Operations,
  myBusinessesV1ResponseSchema,
  registerMyBusinessCommandSchema,
  setMyBusinessLocationCommandSchema,
} from "./operations";

const maxSignedBigint = "9223372036854775807";
const publishedBusinessNumber = "1248100998";

describe("내 계정 operation 계약", () => {
  test("다섯 operation이 모두 server 소유로 registry에 한 번씩 있다", () => {
    const identifiers = [
      "initializeCurrentAccount",
      "listMyBusinesses",
      "registerMyBusiness",
      "setMyBusinessLocation",
      "clearMyBusinessLocation",
    ];

    for (const operationId of identifiers) {
      const found = publicHttpOperationRegistry.filter((operation) => operation.operationId === operationId);
      expect(found.length, operationId).toBe(1);
      expect(found[0]?.implementationOwner, operationId).toBe("server");
    }
  });

  test("semantic route에서 versioned 경로가 파생되고 사업자번호는 경로에 없다", () => {
    expect(meV1Operations.initializeCurrentAccount.openApiPath).toBe("/api/v1/me/initialization");
    expect(meV1Operations.listMyBusinesses.openApiPath).toBe("/api/v1/me/businesses");
    expect(meV1Operations.registerMyBusiness.openApiPath).toBe("/api/v1/me/businesses");
    expect(meV1Operations.setMyBusinessLocation.openApiPath)
      .toBe("/api/v1/me/businesses/{businessId}/location");
    // 경로에는 등록의 bigint 정체성만 들어간다. 요청 경로는 접근 로그와 referrer에 남는다.
    expect(meV1Operations.setMyBusinessLocation.buildPath({ path: { businessId: maxSignedBigint } }))
      .toBe(`/api/v1/me/businesses/${maxSignedBigint}/location`);
    expect(meV1Operations.clearMyBusinessLocation.method).toBe("delete");
  });

  test("등록 명령은 사용자 표기를 canonical 숫자로 정규화하고 검증번호 오류를 형식 실패로 돌린다", () => {
    expect(registerMyBusinessCommandSchema.parse({ businessNumber: "124-81-00998" }))
      .toEqual({ businessNumber: publishedBusinessNumber });
    expect(registerMyBusinessCommandSchema.safeParse({ businessNumber: "124-81-00997" }).success).toBe(false);
    expect(meV1Operations.registerMyBusiness.problemStatuses).toContain(400);
  });

  test("같은 워크스페이스의 중복 등록만 409이고 미인증은 401이다", () => {
    expect(meV1Operations.registerMyBusiness.problemStatuses).toEqual([400, 401, 403, 409, 500, 503]);
    expect(meV1Operations.registerMyBusiness.successStatuses).toEqual([201]);
  });

  test("모든 개인 operation이 403 경로를 계약에 표현한다", () => {
    // 403이 나오는 경로는 넷이다. 신뢰하지 않는 Origin의 상태 변경, 초기화 미완료, 남의 워크스페이스,
    // owner 권한 부족. 계약이 이 status를 숨기면 소비자가 처리할 수 없는 실패가 된다.
    expect(meV1Operations.initializeCurrentAccount.problemStatuses).toEqual([401, 403, 500, 503]);
    expect(meV1Operations.listMyBusinesses.problemStatuses).toEqual([401, 403, 500, 503]);
  });

  test("타 워크스페이스 등록 접근은 403, 없는 등록은 404로 구분한다", () => {
    expect(meV1Operations.setMyBusinessLocation.problemStatuses).toEqual([400, 401, 403, 404, 500, 503]);
    expect(meV1Operations.clearMyBusinessLocation.problemStatuses).toEqual([400, 401, 403, 404, 500, 503]);
  });

  test("빈 설정·미연결·위치 미설정을 각각 다른 값으로 표현한다", () => {
    expect(myBusinessesV1ResponseSchema.parse({ businesses: [] })).toEqual({ businesses: [] });

    const unobserved = registeredBusinessSchema.parse({
      businessId: "1",
      businessNumber: publishedBusinessNumber,
      registeredAt: "2026-09-09T00:00:00Z",
      supplier: { kind: "unobserved" },
      location: null,
    });
    const linked = registeredBusinessSchema.parse({
      businessId: maxSignedBigint,
      businessNumber: publishedBusinessNumber,
      registeredAt: "2026-09-09T00:00:00Z",
      supplier: { kind: "linked", supplierPartyId: maxSignedBigint },
      location: { addressText: "서울특별시 중구 세종대로 110", updatedAt: "2026-09-09T00:00:00Z" },
    });

    expect(unobserved.supplier.kind).toBe("unobserved");
    expect(unobserved.location).toBeNull();
    expect(linked.supplier.kind === "linked" && BigInt(linked.supplier.supplierPartyId))
      .toBe(9223372036854775807n);
  });

  test("응답은 strict라 미관측 등록에 supplier ID 자리를 만들어 주지 않는다", () => {
    expect(registeredBusinessSchema.safeParse({
      businessId: "1",
      businessNumber: publishedBusinessNumber,
      registeredAt: "2026-09-09T00:00:00Z",
      supplier: { kind: "unobserved", supplierPartyId: "1" },
      location: null,
    }).success).toBe(false);
    expect(registeredBusinessSchema.safeParse({
      businessId: "1",
      businessNumber: publishedBusinessNumber,
      registeredAt: "2026-09-09T00:00:00Z",
      supplier: { kind: "unobserved" },
      location: null,
      addressText: "서울",
    }).success).toBe(false);
  });

  test("위치 저장은 공백만 있는 주소를 거부하고 앞뒤 공백을 없앤다", () => {
    expect(setMyBusinessLocationCommandSchema.parse({ addressText: "  서울특별시 중구  " }))
      .toEqual({ addressText: "서울특별시 중구" });
    expect(setMyBusinessLocationCommandSchema.safeParse({ addressText: "   " }).success).toBe(false);
    // 좌표와 행정구역 코드는 이 계약에 자리가 없다. 출처가 생길 때 열과 함께 추가한다.
    expect(setMyBusinessLocationCommandSchema.safeParse({
      addressText: "서울특별시 중구",
      latitude: 37.5,
    }).success).toBe(false);
  });
});
