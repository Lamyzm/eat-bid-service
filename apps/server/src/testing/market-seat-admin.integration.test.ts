import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { Effect } from "effect";
import { Temporal, type Clock } from "@eatbid/domain";

import { observedBusinessNumber, unobservedBusinessNumber, withAccountDatabase } from "../../fixtures/account.fixture";
import { AdministerMarketSeats } from "../modules/entitlement/application/administer-market-seats";
import { MarketSeatTargetNotFound } from "../modules/entitlement/application/market-seat-admin-store";
import { DrizzleMarketSeatAdminStore } from "../modules/entitlement/infrastructure/drizzle/drizzle-market-seat-admin-store";
import type { SeatAssignmentDatabase } from "../modules/entitlement/infrastructure/drizzle/drizzle-seat-assignment-store";

type Sql = { unsafe: (query: string) => Promise<Array<Record<string, unknown>>> };

const GIMHAE = 9300000000000011n;
const YANGSAN = 9300000000000012n;
const NOT_AN_AREA = 9300000000000013n;
const MEAT = 9300000000000021n;

// fixture는 시드를 돌리지 않는다. 저장소가 이름공간으로 체계를 찾으므로 실제 이름 그대로 만든다.
const seed = `
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value values
    (9300000000000001, 'eat:eligibility-area', 'aT', 'source-managed', 'effective-dated'),
    (9300000000000002, 'eatbid:auction-item', 'eatbid', 'source-managed', 'effective-dated'),
    (9300000000000003, 'eat:planned-price-type', 'aT', 'source-managed', 'effective-dated');
  insert into core.code_value (code_value_id, code_scheme_id, code) overriding system value values
    (${GIMHAE}, 9300000000000001, '15653'), (${YANGSAN}, 9300000000000001, '15659'),
    (${NOT_AN_AREA}, 9300000000000003, '002'), (${MEAT}, 9300000000000002, '육류');
`;

async function principal(api: Sql): Promise<bigint> {
  const [row] = await api.unsafe(`insert into app.principal default values returning principal_id::text as id`);
  return BigInt(String(row!.id));
}

async function workspace(api: Sql, name: string, numbers: readonly string[], registeredBy: bigint): Promise<bigint> {
  const [row] = await api.unsafe(`insert into app.workspace (name) values ('${name}') returning workspace_id::text as id`);
  const id = BigInt(String(row!.id));
  for (const number of numbers) {
    await api.unsafe(`insert into app.registered_business (workspace_id, business_number, registered_by_principal_id) values (${id}, '${number}', ${registeredBy})`);
  }
  return id;
}

class MovableClock implements Clock {
  constructor(private instant: Temporal.Instant) {}
  now(): Temporal.Instant {
    return this.instant;
  }
  set(value: string): void {
    this.instant = Temporal.Instant.from(value);
  }
}

describe("운영자 시장 자리 관리", () => {
  test("자리를 주면 번호가 묶이고, 겹치는 기간과 남이 묶은 번호는 이유와 함께 거절하며, 늘리고 거둔 기록이 남는다", async () => {
    await withAccountDatabase(async ({ owner, api }) => {
      await owner.unsafe(seed);
      const operator = await principal(api);
      const odd = await workspace(api, "오뚜기축산", [observedBusinessNumber], operator);
      const dongwon = await workspace(api, "동원축산", [unobservedBusinessNumber], operator);
      // 아버지 계정처럼 같은 번호를 다른 워크스페이스에도 등록해 둔 경우다(ADR 0071 Consequences).
      const twin = await workspace(api, "오뚜기축산(아버지 계정)", [observedBusinessNumber], operator);
      const empty = await workspace(api, "번호 없는 업체", [], operator);

      // KST 2026-11-05 12:00
      const clock = new MovableClock(Temporal.Instant.from("2026-11-05T03:00:00Z"));
      const store = new DrizzleMarketSeatAdminStore(drizzle({ client: api }) as unknown as SeatAssignmentDatabase);
      const admin = new AdministerMarketSeats(store, clock);
      const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
      const base = { actorPrincipalId: operator, reason: "pilot" as const, memo: null };
      const meat = { kind: "atom" as const, atom: "육류" as const };

      const granted = await run(admin.grant({
        ...base, workspaceId: odd, regionCodeValueId: GIMHAE, item: meat, startDate: Temporal.PlainDate.from("2026-11-05"), months: 3,
      }));
      expect(granted.kind).toBe("saved");
      if (granted.kind !== "saved") throw new Error("unreachable");
      const seatId = granted.seat.marketSeatId;
      expect(granted.seat.startsAt).toEqual(clock.now());
      expect(granted.seat.endsAt).toEqual(Temporal.Instant.from("2027-02-04T15:00:00Z"));
      expect(granted.seat.priorityStartedAt).toEqual(clock.now());
      expect(granted.seat.workspace.businessNumbers).toEqual([observedBusinessNumber]);
      expect(granted.seat.events.map((event) => event.kind)).toEqual(["activated"]);
      expect(await api.unsafe(`select business_number::text as number from app.seat_business_claim where workspace_id = ${odd}`))
        .toEqual([{ number: observedBusinessNumber }]);

      // 같은 시장을 겹치는 기간에 다른 업체에 주면 누가 언제까지 쓰는지와 함께 거절한다.
      expect(await run(admin.grant({
        ...base, workspaceId: dongwon, regionCodeValueId: GIMHAE, item: meat, startDate: Temporal.PlainDate.from("2026-12-01"), months: 1,
      }))).toEqual({
        kind: "rejected",
        rejection: { reason: "period-overlap", holder: { workspaceId: odd, name: "오뚜기축산" }, holderEndsAt: Temporal.Instant.from("2027-02-04T15:00:00Z") },
      });
      // 같은 번호를 쓰는 다른 계정에는 다른 시장도 주지 않는다. 거절되면 자리 행도 남지 않는다.
      expect(await run(admin.grant({
        ...base, workspaceId: twin, regionCodeValueId: YANGSAN, item: meat, startDate: Temporal.PlainDate.from("2026-11-05"), months: 1,
      }))).toEqual({
        kind: "rejected",
        rejection: { reason: "business-claimed-elsewhere", businessNumber: observedBusinessNumber, holder: { workspaceId: odd, name: "오뚜기축산" } },
      });
      expect(await api.unsafe(`select count(*)::int as count from app.market_seat where workspace_id = ${twin}`)).toEqual([{ count: 0 }]);

      expect((await run(admin.grant({
        ...base, workspaceId: empty, regionCodeValueId: YANGSAN, item: meat, startDate: Temporal.PlainDate.from("2026-11-05"), months: 1,
      }))).kind === "rejected").toBe(true);
      expect(await run(admin.grant({
        ...base, workspaceId: dongwon, regionCodeValueId: NOT_AN_AREA, item: meat, startDate: Temporal.PlainDate.from("2026-11-05"), months: 1,
      }))).toEqual({ kind: "rejected", rejection: { reason: "region-not-eligibility-area" } });
      // "품목 제한 없음" 코드는 수집이 관측하기 전에는 없다.
      expect(await run(admin.grant({
        ...base, workspaceId: dongwon, regionCodeValueId: YANGSAN, item: { kind: "no-main-item-restriction" }, startDate: Temporal.PlainDate.from("2026-11-05"), months: 1,
      }))).toEqual({ kind: "rejected", rejection: { reason: "item-not-observed" } });
      expect(await run(admin.grant({
        ...base, reason: "other", workspaceId: dongwon, regionCodeValueId: YANGSAN, item: meat, startDate: Temporal.PlainDate.from("2026-11-05"), months: 1,
      }))).toEqual({ kind: "rejected", rejection: { reason: "memo-required" } });
      // `expect(...).rejects`로 받으면 이 파일에서 BEGIN 뒤 첫 쿼리가 전송되지 않고 멈췄다(2026-11-05). 결과를 직접 받아 본다.
      const missing = await run(admin.grant({
        ...base, workspaceId: 9300000000000999n, regionCodeValueId: YANGSAN, item: meat, startDate: Temporal.PlainDate.from("2026-11-05"), months: 1,
      })).then(() => null, (error: unknown) => error);
      expect(missing).toBeInstanceOf(MarketSeatTargetNotFound);

      // 늘리면 끝만 움직이고 우선권 시작일은 그대로다.
      const extended = await run(admin.extend({ ...base, reason: "payment-confirmed", memo: "1개월 입금", marketSeatId: seatId, months: 1 }));
      if (extended.kind !== "saved") throw new Error(`extend rejected: ${JSON.stringify(extended)}`);
      expect(extended.seat.endsAt).toEqual(Temporal.Instant.from("2027-03-04T15:00:00Z"));
      expect(extended.seat.priorityStartedAt).toEqual(granted.seat.priorityStartedAt);
      expect(extended.seat.events[0]).toMatchObject({
        kind: "extended", reason: "payment-confirmed", memo: "1개월 입금",
        previousEndsAt: Temporal.Instant.from("2027-02-04T15:00:00Z"), nextEndsAt: Temporal.Instant.from("2027-03-04T15:00:00Z"),
      });

      // 거두면 지금에서 끝나고 번호도 풀려, 같은 번호의 다른 계정이 자리를 받을 수 있다.
      clock.set("2026-11-10T03:00:00Z");
      const revoked = await run(admin.revoke({ ...base, reason: "operator-correction", memo: "계정 정리", marketSeatId: seatId }));
      if (revoked.kind !== "saved") throw new Error(`revoke rejected: ${JSON.stringify(revoked)}`);
      expect(revoked.seat.endsAt).toEqual(clock.now());
      expect(await run(admin.revoke({ ...base, marketSeatId: seatId }))).toEqual({ kind: "rejected", rejection: { reason: "seat-ended" } });
      const moved = await run(admin.grant({
        ...base, workspaceId: twin, regionCodeValueId: GIMHAE, item: meat, startDate: Temporal.PlainDate.from("2026-11-10"), months: 1,
      }));
      expect(moved.kind).toBe("saved");

      const listed = await run(admin.listSeats());
      expect(listed.seats.map((seat) => [seat.workspace.name, seat.endsAt.toString()])).toEqual([
        ["오뚜기축산", "2026-11-10T03:00:00Z"],
        ["오뚜기축산(아버지 계정)", "2026-12-09T15:00:00Z"],
      ]);
      const workspaces = await run(admin.listWorkspaces());
      expect(workspaces.find((entry) => entry.workspaceId === empty)?.businessNumbers).toEqual([]);
    });
  }, 120_000);
});
