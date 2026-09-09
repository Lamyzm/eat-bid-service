import { describe, expect, test } from "bun:test";

import { organizationV1Operations } from "./operations";
import { organizationAuctionAttemptsV1ResponseSchema } from "./list-auction-attempts.response";

const { querySchema } = organizationV1Operations.listAuctionAttempts;
const asOf = "2026-09-06T00:00:00Z";

describe("회차 이력 build 고정과 revision 노출 계약", () => {
  test("revision은 요청한 소비자에게만 실리고 null 자리를 만들지 않는다", () => {
    const attempt = organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element;
    const row = {
      attemptId: "5796468", announcedAt: "2026-09-01T00:00:00Z", openedAt: null,
      item: null, floorRate: null, baseAmount: { amount: "2761700.00", currency: "KRW" },
      winRate: null, secondRate: null, awardedBidRate: null, dayFloorRate: null,
      listCount: null, belowDayFloorCount: null,
      winnerSupplierPartyId: null, supersedesAttemptId: null,
    };

    expect(attempt.parse(row)).not.toHaveProperty("revisionId");
    expect(attempt.parse({ ...row, revisionId: "208" }).revisionId).toBe("208");
    // mart 열이 not null이라 미관측 revision은 없다. null을 받으면 없는 상태를 하나 지어내는 셈이다.
    expect(() => attempt.parse({ ...row, revisionId: null })).toThrow();
    expect(() => attempt.parse({ ...row, revisionId: 208 })).toThrow();
  });

  test("includeRevision은 명시 요청만 허용하고 false 문자열을 true로 읽지 않는다", () => {
    expect(querySchema.parse({ includeRevision: "true" }).includeRevision).toBe("true");
    expect(querySchema.parse({})).not.toHaveProperty("includeRevision");
    expect(() => querySchema.parse({ includeRevision: "false" })).toThrow();
  });

  test("build 고정과 개찰 기준 시각은 한 쌍이라 반쪽 요청을 거부한다", () => {
    expect(querySchema.parse({ expectedBuildId: "501", asOf }))
      .toMatchObject({ expectedBuildId: "501", asOf, opened: "only" });
    // build만 고정하면 그 사이 개찰된 회차가 누적 목록에 새로 끼어든다.
    expect(() => querySchema.parse({ expectedBuildId: "501" })).toThrow();
    // 시각만 고정하면 발행 뒤 다른 build의 같은 시각 집합을 읽는다.
    expect(() => querySchema.parse({ asOf })).toThrow();
  });

  test("opened=any는 비교 기준 시각이 없으므로 asOf를 받지 않는다", () => {
    expect(querySchema.parse({ opened: "any", expectedBuildId: "501" }))
      .toMatchObject({ opened: "any", expectedBuildId: "501" });
    expect(() => querySchema.parse({ opened: "any", expectedBuildId: "501", asOf })).toThrow();
  });

  test("고정 값은 canonical bigint 문자열과 UTC instant 문자열만 받는다", () => {
    expect(() => querySchema.parse({ expectedBuildId: "0", asOf })).toThrow();
    expect(() => querySchema.parse({ expectedBuildId: "501", asOf: "2026-09-06" })).toThrow();
    expect(() => querySchema.parse({ expectedBuildId: "501", asOf: "2026-09-06T00:00:00+09:00" })).toThrow();
  });

  test("build 전환은 cursor 오류와 다른 status로 계약에 있다", () => {
    // 400은 같은 build 안의 잘못된 cursor다. 409는 그 build 자체가 사라진 것이라 재조회가 답이다.
    expect(organizationV1Operations.listAuctionAttempts.problemStatuses)
      .toEqual([400, 401, 404, 409, 500, 503]);
  });

  test("고정 query도 canonical 경로로 조립된다", () => {
    expect(organizationV1Operations.listAuctionAttempts.buildPath({
      path: { organizationId: "42" },
      query: { limit: 12, opened: "only", expectedBuildId: "501", asOf, cursor: "5796468" },
    })).toBe(
      "/api/v1/organizations/42/auction-attempts"
      + `?asOf=${encodeURIComponent(asOf)}&cursor=5796468&expectedBuildId=501&limit=12&opened=only`,
    );
  });
});
