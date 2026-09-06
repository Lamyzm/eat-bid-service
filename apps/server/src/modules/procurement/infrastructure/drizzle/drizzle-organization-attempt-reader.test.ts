import { describe, expect, test } from "bun:test";
import { isMoney, Temporal } from "@eatbid/domain";

const row = {
  auction_attempt_id: "5796468",
  announced_at: new Date("2026-09-01T00:00:00.000Z"),
  opened_at: null,
  item_code_value_id: "7",
  item_label: "축산",
  floor_rate: "90.000",
  base_amount: "2761700.00",
  currency: "KRW",
  awarded_assessment_rate: "90.309",
  runner_up_assessment_rate: null,
  day_floor_bid_rate: "88.0350",
  list_count: 17,
  below_day_floor_count: 2,
  winner_supplier_party_id: "9",
  supersedes_attempt_id: null,
} as const;

describe("DrizzleOrganizationAttemptReader row 경계", () => {
  test("mart 요약 행을 도메인 값으로 매핑하고 numeric 문자열의 정밀도를 보존한다", async () => {
    const adapter = await import("./drizzle-organization-attempt-reader").catch(() => undefined);
    expect(adapter, "기관 회차 어댑터가 있어야 한다").toBeDefined();
    const record = adapter!.mapAttemptRow({ ...row, source_payload: { mustNotEscape: true } } as never);
    expect(record).toMatchObject({
      attemptId: 5_796_468n,
      openedAt: null,
      item: { codeValueId: 7n, label: "축산" },
      floorRate: "90.000",
      baseAmount: { amount: "2761700.00", currency: "KRW" },
      winRate: "90.309",
      secondRate: null,
      listCount: 17,
      winnerSupplierPartyId: 9n,
      supersedesAttemptId: null,
    });
    expect(record.announcedAt).toBeInstanceOf(Temporal.Instant);
    expect(record.announcedAt.toString()).toBe("2026-09-01T00:00:00Z");
    expect(isMoney(record.baseAmount)).toBe(true);
    expect(record).not.toHaveProperty("source_payload");
  });

  test("계보는 행이 아니라 build가 가지므로 행 매핑에 계보가 섞이지 않는다", async () => {
    const adapter = await import("./drizzle-organization-attempt-reader");
    const record = adapter.mapAttemptRow(row as never);

    for (const name of ["martRelease", "buildId", "calcVersion", "computedAt", "sourceReleaseId"]) {
      expect(record).not.toHaveProperty(name);
    }
  });

  test("그날 하한은 투찰률 축이라 넷째 자리를 반올림 없이 옮기고 하한 미만 수를 함께 싣는다", async () => {
    const adapter = await import("./drizzle-organization-attempt-reader");
    const record = adapter.mapAttemptRow(row as never);

    expect(record.dayFloorRate).toBe("88.0350");
    expect(record.belowDayFloorCount).toBe(2);
    // 사정률 축과 섞이지 않는다. 셋째 자리 문자열은 이 열의 scale이 아니다.
    expect(() => adapter.mapAttemptRow({ ...row, day_floor_bid_rate: "88.035" } as never)).toThrow(TypeError);
  });

  test("품목 코드나 라벨이 없으면 라벨을 지어내지 않고 item을 unknown으로 남긴다", async () => {
    const adapter = await import("./drizzle-organization-attempt-reader");
    expect(adapter.mapAttemptRow({ ...row, item_code_value_id: null } as never).item).toBeNull();
    expect(adapter.mapAttemptRow({ ...row, item_label: null } as never).item).toBeNull();
    expect(adapter.mapAttemptRow({ ...row, item_label: "   " } as never).item).toBeNull();
    expect(adapter.mapAttemptRow({ ...row, item_label: " 축산 " } as never).item?.label).toBe("축산");
  });

  test("KRW가 아닌 통화와 scale이 다른 비율 문자열은 TypeError로 거부한다", async () => {
    const adapter = await import("./drizzle-organization-attempt-reader");
    expect(() => adapter.mapAttemptRow({ ...row, currency: "USD" } as never)).toThrow(TypeError);
    expect(() => adapter.mapAttemptRow({ ...row, awarded_assessment_rate: "90.3" } as never)).toThrow(TypeError);
    expect(() => adapter.mapAttemptRow({ ...row, announced_at: null } as never)).toThrow(TypeError);
  });
});
