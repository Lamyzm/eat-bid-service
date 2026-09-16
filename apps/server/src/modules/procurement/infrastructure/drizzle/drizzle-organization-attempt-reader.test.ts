import { describe, expect, test } from "bun:test";
import { isMoney, Temporal } from "@eatbid/domain";

const row = {
  auction_attempt_id: "5796468",
  auction_revision_id: "208",
  announced_at: new Date("2026-09-01T00:00:00.000Z"),
  opened_at: null,
  item_code_value_id: "7",
  item_label: "축산",
  floor_rate: "90.000",
  award_method_code_value_id: null,
  base_amount: "2761700.00",
  currency: "KRW",
  awarded_assessment_rate: "90.309",
  runner_up_assessment_rate: null,
  awarded_bid_rate: "88.3020",
  day_floor_bid_rate: "88.0350",
  list_count: 17,
  below_day_floor_count: 2,
  winner_supplier_party_id: "9",
  supersedes_attempt_id: null,
} as const;

describe("DrizzleOrganizationAttemptReader row 경계", () => {
  test("품목 코드가 없어도 관측 라벨은 보존하고 코드 정체성을 만들지 않는다", async () => {
    const { mapAttemptRow } = await import("./drizzle-organization-attempt-reader");
    const result = mapAttemptRow({ ...row, item_code_value_id: null, item_label: " 육류 , 가금류 " });
    expect(result.item).toBeNull();
    expect(result.itemLabel).toBe("육류 , 가금류");
    for (const item_label of [null, "", "   "]) {
      expect(mapAttemptRow({ ...row, item_label }).itemLabel).toBeNull();
    }
  });

  test("낙찰과 차순위의 100 초과 관측률을 각각 손실 없이 옮긴다", async () => {
    const { mapAttemptRow } = await import("./drizzle-organization-attempt-reader");
    // 음수도 관측이다(2026-03 창 명단의 -2507.667, ADR 0053). DB가 보존한 값을 어댑터가 거부하면 503이 된다.
    for (const value of ["100.001", "101.975", "102.297", "999999999999.999", "-1.000", "-2507.667"]) {
      expect(mapAttemptRow({ ...row, awarded_assessment_rate: value }).winRate).toBe(value);
      expect(mapAttemptRow({ ...row, runner_up_assessment_rate: value }).secondRate).toBe(value);
    }
    expect(mapAttemptRow({ ...row, awarded_assessment_rate: null }).winRate).toBeNull();
    expect(mapAttemptRow(row).secondRate).toBeNull();
    for (const value of ["-0.000", "102.2970", "102.29", "1000000000000.000"]) {
      expect(() => mapAttemptRow({ ...row, awarded_assessment_rate: value })).toThrow(TypeError);
      expect(() => mapAttemptRow({ ...row, runner_up_assessment_rate: value })).toThrow(TypeError);
    }
    expect(() => mapAttemptRow({ ...row, floor_rate: "100.001" })).toThrow(TypeError);
  });

  test("mart 요약 행을 도메인 값으로 매핑하고 numeric 문자열의 정밀도를 보존한다", async () => {
    const adapter = await import("./drizzle-organization-attempt-reader").catch(() => undefined);
    expect(adapter, "기관 회차 어댑터가 있어야 한다").toBeDefined();
    const record = adapter!.mapAttemptRow({ ...row, source_payload: { mustNotEscape: true } } as never);
    expect(record).toMatchObject({
      attemptId: 5_796_468n,
      // 요약이 요약한 해석이다. 개인 투찰 조회가 이 값으로 명단을 찾으므로 최신 revision과 섞이면 안 된다.
      revisionId: 208n,
      openedAt: null,
      item: { codeValueId: 7n, label: "축산" },
      floorRate: "90.000",
      baseAmount: { amount: "2761700.00", currency: "KRW" },
      winRate: "90.309",
      secondRate: null,
      // 같은 낙찰의 두 축이 각자의 열에서 온다. 값이 같아지면 어느 한쪽을 다른 쪽에서 지어낸 것이다.
      awardedBidRate: "88.3020",
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

  test("예정가격 미관측 회차는 그날 하한과 하한 미만 수가 0이 아니라 null로 온다", async () => {
    const adapter = await import("./drizzle-organization-attempt-reader");

    // mart가 예정가격 0(추첨 전) 회차의 파생값을 비워 보낸다(EAT-74). 어댑터는 그 없음을 0으로
    // 메우지 않고 그대로 옮겨야 화면이 그 회차를 판정 분모에서 뺄 수 있다.
    const unobserved = adapter.mapAttemptRow({
      ...row,
      opened_at: null,
      awarded_assessment_rate: null,
      awarded_bid_rate: null,
      day_floor_bid_rate: null,
      below_day_floor_count: null,
      winner_supplier_party_id: null,
    } as never);
    expect(unobserved.dayFloorRate).toBeNull();
    expect(unobserved.belowDayFloorCount).toBeNull();
    expect(unobserved.awardedBidRate).toBeNull();
    // 하한율 자체는 공고 조건의 관측값이라 예정가격과 무관하게 남는다.
    expect(unobserved.floorRate).toBe("90.000");
    expect(unobserved.listCount).toBe(17);
  });

  test("투찰률 축 낙찰률은 사정률 열이 아니라 awarded_bid_rate 열에서만 온다", async () => {
    const adapter = await import("./drizzle-organization-attempt-reader");

    // 예정가격이 아직 관측되지 않은 회차는 축을 옮길 입력이 없다. 사정률로 대신 채우지 않는다.
    const unknownAxis = adapter.mapAttemptRow({ ...row, awarded_bid_rate: null } as never);
    expect(unknownAxis.awardedBidRate).toBeNull();
    expect(unknownAxis.winRate).toBe("90.309");
    // 그날 하한과 같은 넷째 자리 scale이라야 화면이 두 값을 같은 정밀도로 견준다.
    expect(() => adapter.mapAttemptRow({ ...row, awarded_bid_rate: "88.302" } as never)).toThrow(TypeError);
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
