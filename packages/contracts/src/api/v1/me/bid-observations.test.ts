import { describe, expect, test } from "bun:test";

import { publicHttpOperationRegistry } from "../../registry";
import { myAttemptBidObservationSchema, myBidSubmissionSchema } from "./bid-observation.resource";
import { myBidObservationV1Operations } from "./bid-observations.operations";
import { findMyBidObservationsCommandSchema, maxBidObservationAttempts } from "./find-bid-observations.command";
import { myBidObservationsV1ResponseSchema } from "./find-bid-observations.response";

const operation = myBidObservationV1Operations.findMyBidObservations;
const maxSignedBigint = "9223372036854775807";
const provenance = {
  sourceSystem: "eat",
  observationId: "203",
  normalizedRecordId: "206",
  contentSha256: "e".repeat(64),
};
const submission = {
  submissionId: "9001",
  rosterOrdinal: 3,
  supplierPartyId: "77",
  sourceSupplierAccountId: "310",
  sourceCalculatedAmount: { amount: "10000000043768.00", currency: "KRW" },
  submittedAmount: { amount: "43120180.00", currency: "KRW" },
  bidRate: { value: "90.309", unit: "percentage-points" },
  rank: 1,
  submittedAt: "2026-09-04T04:59:00Z",
  sourceStatus: { codeValueId: "31", code: "1", scheme: "eat:bid-status", label: "정상" },
};
const emptyLineage = {
  buildId: "501",
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "mart-r1",
  computedAt: "2026-09-04T00:10:00Z",
  coverage: "complete",
  regionScheme: "eat:auction-location-sigungu",
} as const;

describe("내 투찰 관측 operation 계약", () => {
  test("me resource의 server 소유 operation으로 registry에 한 번 있다", () => {
    const found = publicHttpOperationRegistry.filter((entry) => entry.operationId === "findMyBidObservations");
    expect(found).toHaveLength(1);
    expect(found[0]?.implementationOwner).toBe("server");
    // 개인 응답의 캐시 금지는 이 resource prefix가 소유하므로 route가 me 아래에 있어야 한다.
    expect(found[0]?.route.resource).toBe("me");
  });

  test("semantic route에서 versioned 경로가 파생되고 사업자번호는 경로에 없다", () => {
    expect(operation.openApiPath).toBe("/api/v1/me/businesses/{businessId}/bid-observations");
    expect(operation.buildPath({ path: { businessId: maxSignedBigint } }))
      .toBe(`/api/v1/me/businesses/${maxSignedBigint}/bid-observations`);
    expect(operation.method).toBe("post");
  });

  test("타 워크스페이스는 403, 없는 등록은 404, build 전환은 409로 나뉜다", () => {
    expect(operation.problemStatuses).toEqual([400, 401, 403, 404, 409, 500, 503]);
    expect(operation.successStatuses).toEqual([200]);
  });

  test("요청은 build와 기관을 함께 고정하고 회차 상한과 중복을 거부한다", () => {
    const key = { attemptId: "102", revisionId: "208" };
    expect(findMyBidObservationsCommandSchema.parse({
      organizationId: "41", buildId: "501", attempts: [key],
    })).toEqual({ organizationId: "41", buildId: "501", attempts: [key] });

    // 같은 회차를 두 revision으로 물으면 응답이 한 회차에 두 결과를 실어야 한다.
    expect(findMyBidObservationsCommandSchema.safeParse({
      organizationId: "41", buildId: "501",
      attempts: [key, { attemptId: "102", revisionId: "999" }],
    }).success).toBe(false);
    expect(findMyBidObservationsCommandSchema.safeParse({
      organizationId: "41", buildId: "501", attempts: [],
    }).success).toBe(false);

    const tooMany = Array.from({ length: maxBidObservationAttempts + 1 }, (_row, index) => ({
      attemptId: String(index + 1),
      revisionId: String(index + 1),
    }));
    expect(findMyBidObservationsCommandSchema.safeParse({
      organizationId: "41", buildId: "501", attempts: tooMany,
    }).success).toBe(false);
    // 화면이 그리는 60회차는 상한 안이다. 기본 12와 상한 200은 서로 다른 값이다.
    expect(findMyBidObservationsCommandSchema.safeParse({
      organizationId: "41", buildId: "501", attempts: tooMany.slice(0, 60),
    }).success).toBe(true);
  });

  test("build 없는 요청과 기관 없는 요청을 받지 않는다", () => {
    expect(findMyBidObservationsCommandSchema.safeParse({
      organizationId: "41", attempts: [{ attemptId: "102", revisionId: "208" }],
    }).success).toBe(false);
    expect(findMyBidObservationsCommandSchema.safeParse({
      buildId: "501", attempts: [{ attemptId: "102", revisionId: "208" }],
    }).success).toBe(false);
  });

  test("관측 행은 두 금액을 분리해 담고 실제 금액 미관측을 null로 보존한다", () => {
    expect(myBidSubmissionSchema.parse(submission)).toEqual(submission);
    // BID_CALC_AMT 자리표시자가 실재하므로 EFT_ALL_AMT가 없다고 계산 금액으로 대체하지 않는다.
    expect(myBidSubmissionSchema.parse({ ...submission, submittedAmount: null }).submittedAmount).toBeNull();
    expect(() => myBidSubmissionSchema.parse({ ...submission, sourceCalculatedAmount: null })).toThrow();
    // 사업자번호·상호·주소는 이 행에 자리가 없다.
    expect(myBidSubmissionSchema.safeParse({ ...submission, businessNumber: "1248100998" }).success).toBe(false);
    expect(myBidSubmissionSchema.safeParse({ ...submission, supplierName: "어떤 업체" }).success).toBe(false);
  });

  test("사정률은 100을 넘는 관측을 보존하고 셋째 자리 정밀도를 강제한다", () => {
    for (const value of ["100.001", "44477738.050", "999999999999.999"]) {
      expect(myBidSubmissionSchema.parse({ ...submission, bidRate: { value, unit: "percentage-points" } }).bidRate.value)
        .toBe(value);
    }
    expect(() => myBidSubmissionSchema.parse({ ...submission, bidRate: { value: "90.3090", unit: "percentage-points" } })).toThrow();
    expect(() => myBidSubmissionSchema.parse({ ...submission, bidRate: null })).toThrow();
  });

  test("회차 결과는 제출·명단에 없음·명단 미관측·증거 불일치를 이름으로 나눈다", () => {
    const key = { attemptId: "102", revisionId: "208" };
    const observedAt = "2026-09-03T00:00:30Z";
    const submitted = myAttemptBidObservationSchema.parse({
      ...key,
      result: { kind: "submitted", rows: [submission], rosterRowCount: 5, observedAt, provenance },
    });
    expect(submitted.result.kind === "submitted" && submitted.result.rows).toHaveLength(1);

    expect(myAttemptBidObservationSchema.parse({
      ...key, result: { kind: "absent-from-roster", rosterRowCount: 5, observedAt, provenance },
    }).result.kind).toBe("absent-from-roster");
    expect(myAttemptBidObservationSchema.parse({
      ...key, result: { kind: "roster-not-observed", provenance },
    }).result.kind).toBe("roster-not-observed");
    expect(myAttemptBidObservationSchema.parse({
      ...key, result: { kind: "evidence-conflict", reason: "observation-time-conflict" },
    }).result.kind).toBe("evidence-conflict");
    // 명단 행이 revision을 낳은 관측이 아닌 다른 관측을 가리키는 것도 그 회차의 격리 이유다.
    const mismatch = myAttemptBidObservationSchema.parse({
      ...key, result: { kind: "evidence-conflict", reason: "roster-observation-mismatch" },
    });
    expect(mismatch.result.kind === "evidence-conflict" && mismatch.result.reason)
      .toBe("roster-observation-mismatch");

    // 제출 상태에 빈 배열을 허용하면 "행이 없다"가 두 이름으로 표현된다.
    expect(myAttemptBidObservationSchema.safeParse({
      ...key, result: { kind: "submitted", rows: [], rosterRowCount: 5, observedAt, provenance },
    }).success).toBe(false);
    // 명단이 미관측인데 행 수를 실으면 세지 않은 수를 관측처럼 말하게 된다.
    expect(myAttemptBidObservationSchema.safeParse({
      ...key, result: { kind: "roster-not-observed", provenance, rosterRowCount: 0 },
    }).success).toBe(false);
    expect(myAttemptBidObservationSchema.safeParse({
      ...key, result: { kind: "evidence-conflict", reason: "알 수 없음" },
    }).success).toBe(false);
  });

  test("미연결·증거 불일치 사업자에는 회차 목록 자리를 만들지 않는다", () => {
    const base = { businessId: "9", organizationId: "41", meta: emptyLineage };
    const unobserved = myBidObservationsV1ResponseSchema.parse({
      ...base, supplier: { kind: "unobserved" },
    });
    expect(unobserved.supplier).toEqual({ kind: "unobserved" });
    expect(myBidObservationsV1ResponseSchema.parse({
      ...base, supplier: { kind: "evidence-conflict" },
    }).supplier.kind).toBe("evidence-conflict");
    // 빈 배열은 "찾아봤지만 없었다"로 읽힌다. 대조 자체를 못 한 상태와 같은 모양이면 안 된다.
    expect(myBidObservationsV1ResponseSchema.safeParse({
      ...base, supplier: { kind: "unobserved", attempts: [] },
    }).success).toBe(false);
    expect(myBidObservationsV1ResponseSchema.safeParse({
      ...base, supplier: { kind: "observed", supplierPartyId: "77" },
    }).success).toBe(false);
  });

  test("응답 meta는 회차 이력과 같은 build 계보를 싣는다", () => {
    const parsed = myBidObservationsV1ResponseSchema.parse({
      businessId: "9",
      organizationId: "41",
      supplier: { kind: "observed", supplierPartyId: "77", attempts: [] },
      meta: emptyLineage,
    });
    expect(parsed.meta).toEqual(emptyLineage);
    expect(() => myBidObservationsV1ResponseSchema.parse({
      businessId: "9",
      organizationId: "41",
      supplier: { kind: "observed", supplierPartyId: "77", attempts: [] },
      meta: { ...emptyLineage, martRelease: "2026-09-04" },
    })).toThrow();
  });
});
