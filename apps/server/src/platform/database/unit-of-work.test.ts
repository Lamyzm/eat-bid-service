import { describe, expect, test } from "bun:test";

describe("검증 범위를 정의한다 — UnitOfWork", () => {
  test("통과 조건을 검증한다 — passes one transaction handle to every participant", async () => {
    const database = await import("./unit-of-work").catch(() => undefined);
    expect(database, "UnitOfWork must exist").toBeDefined();
    const rawTransaction = { id: "tx-1" };
    const unitOfWork = database!.createUnitOfWork({
      transaction: async (work: (transaction: unknown) => Promise<unknown>) => work(rawTransaction),
    });
    const observed: unknown[] = [];
    await unitOfWork.run(async (transaction: unknown) => {
      observed.push(transaction);
      observed.push(transaction);
    });
    expect(observed).toHaveLength(2);
    expect(observed[0]).toBe(observed[1]);
    expect(database!.transactionDatabase(observed[0])).toBe(rawTransaction);
  });

  test("보존 불변식을 검증한다 — preserves typed failures and defects so the database transaction rolls back", async () => {
    const database = await import("./unit-of-work").catch(() => undefined);
    expect(database, "UnitOfWork must exist").toBeDefined();
    const events: string[] = [];
    const driver = {
      transaction: async (work: (transaction: unknown) => Promise<unknown>) => {
        events.push("begin");
        try {
          const value = await work({ id: "tx-2" });
          events.push("commit");
          return value;
        } catch (error) {
          events.push("rollback");
          throw error;
        }
      },
    };
    const typed = Object.assign(new Error("expected"), { code: "EXPECTED_FAILURE" as const });
    await expect(database!.createUnitOfWork(driver).run(async () => { throw typed; })).rejects.toBe(typed);
    await expect(database!.createUnitOfWork(driver).run(async () => { throw new TypeError("defect"); }))
      .rejects.toBeInstanceOf(TypeError);
    expect(events).toEqual(["begin", "rollback", "begin", "rollback"]);
  });
});
