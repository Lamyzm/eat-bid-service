import { describe, expect, test } from "bun:test";
import { boolean, getTableConfig, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { inspectAuthSchema } from "../../../tools/check-auth-schema.js";
import { authAccount, authProviderTables, authRateLimit, authSession, authUser } from "./auth.js";
import { authSchemaOptions, authTableNames } from "./auth-schema-options.js";

const app = pgSchema("app");

function ruleNames(findings: Awaited<ReturnType<typeof inspectAuthSchema>>): string[] {
  return findings.map((finding) => finding.rule);
}

describe("Better Auth provider schema 대조", () => {
  test("커밋된 Drizzle table이 pinned CLI generator 결과와 일치한다", async () => {
    expect(await inspectAuthSchema()).toEqual([]);
  });

  test("provider가 요구하는 표를 빠뜨리면 대조가 실패한다", async () => {
    const { [authTableNames.session]: _omitted, ...withoutSession } = authProviderTables;

    const findings = await inspectAuthSchema({ tables: withoutSession });

    expect(findings).toContainEqual({
      table: authTableNames.session,
      rule: "missing-table",
      reason: "pinned generator가 만드는 표가 Drizzle schema에 없습니다.",
    });
  });

  test("rate limit 저장을 끄면 남는 표를 잡아낸다", async () => {
    const { rateLimit: _dropped, ...withoutRateLimitTable } = authSchemaOptions;

    const findings = await inspectAuthSchema({ options: withoutRateLimitTable });

    expect(findings).toContainEqual({
      table: authTableNames.rateLimit,
      rule: "unexpected-table",
      reason: "pinned generator가 만들지 않는 표를 provider 소유로 선언했습니다.",
    });
  });

  test("id의 primary key나 not null을 없애면 대조가 실패한다", async () => {
    const withoutPrimaryKey = app.table(authTableNames.rateLimit, {
      id: text("id").notNull(),
      key: text("key").notNull().unique(),
      count: integer("count").notNull(),
      lastRequest: integer("lastRequest").notNull(),
    });

    const findings = await inspectAuthSchema({
      tables: { ...authProviderTables, [authTableNames.rateLimit]: withoutPrimaryKey },
    });

    expect(ruleNames(findings)).toContain("column-primary-key");
    expect(ruleNames(findings)).toContain("missing-index");
  });

  test("밀리초 시각 열을 int4로 좁히면 대조가 실패한다", async () => {
    // 허용된 차이는 물리 타입이 같은 bigint 하나뿐이다. `integer`는 밀리초 epoch에서 넘친다.
    const narrowed = app.table(authTableNames.rateLimit, {
      id: text("id").primaryKey(),
      key: text("key").notNull().unique(),
      count: integer("count").notNull(),
      lastRequest: integer("lastRequest").notNull(),
    });

    const findings = await inspectAuthSchema({
      tables: { ...authProviderTables, [authTableNames.rateLimit]: narrowed },
    });

    expect(findings.some((finding) =>
      finding.rule === "column-type" && finding.reason.includes("lastRequest"))).toBe(true);
  });

  test("물리 table 이름을 바꾸면 대조가 실패한다", async () => {
    const renamed = app.table("auth_rate_limits", {
      id: text("id").primaryKey(),
      key: text("key").notNull().unique(),
      count: integer("count").notNull(),
      lastRequest: integer("lastRequest").notNull(),
    });

    const findings = await inspectAuthSchema({
      tables: { ...authProviderTables, [authTableNames.rateLimit]: renamed },
    });

    expect(ruleNames(findings)).toContain("missing-table");
    expect(ruleNames(findings)).toContain("unexpected-table");
    expect(ruleNames(findings)).toContain("schema-key");
  });

  test("물리 열은 같아도 property 이름을 바꾸면 대조가 실패한다", async () => {
    // adapter는 `table[fieldName]`으로 열에 접근하므로 property 이름만 달라도 런타임 질의가 깨진다.
    const renamedProperty = app.table(authTableNames.verification, {
      id: text("id").primaryKey(),
      identifier: text("identifier").notNull(),
      value: text("value").notNull(),
      expiry: timestamp("expiresAt", { withTimezone: true }).notNull(),
      createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
      updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
    });

    const findings = await inspectAuthSchema({
      tables: { ...authProviderTables, [authTableNames.verification]: renamedProperty },
    });

    expect(ruleNames(findings)).toContain("missing-column");
    expect(ruleNames(findings)).toContain("unexpected-column");
  });

  test("필수 열을 nullable로 바꾸면 대조가 실패한다", async () => {
    const nullable = app.table(authTableNames.user, {
      id: text("id").primaryKey(),
      name: text("name").notNull(),
      email: text("email").notNull().unique(),
      emailVerified: boolean("emailVerified").default(false),
      image: text("image"),
      createdAt: timestamp("createdAt", { withTimezone: true }).notNull(),
      updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull(),
    });

    const findings = await inspectAuthSchema({
      tables: { ...authProviderTables, [authTableNames.user]: nullable },
    });

    expect(ruleNames(findings)).toContain("column-nullability");
  });
});

describe("provider table의 저장소 경계", () => {
  test("provider 표는 app schema에 있고 문자열 id를 어떤 업무 FK로도 쓰지 않는다", () => {
    for (const table of Object.values(authProviderTables)) {
      const config = getTableConfig(table);
      expect(config.schema).toBe("app");
      expect(config.columns.find((column) => column.name === "id")?.columnType).toBe("PgText");
    }

    // provider 문자열 참조는 auth 표 안에서만 닫힌다. 업무 관계는 identity_subject를 거쳐 bigint로만 간다.
    const providerTableNames = new Set(Object.values(authTableNames));
    for (const table of [authAccount, authSession, authUser, authRateLimit]) {
      for (const key of getTableConfig(table).foreignKeys) {
        expect(providerTableNames).toContain(getTableConfig(key.reference().foreignTable).name);
      }
    }
  });

  test("외부 provider subject는 account 행에만 남고 auth user id와 구분된다", () => {
    const account = getTableConfig(authAccount).columns.map((column) => column.name);

    expect(account).toContain("accountId");
    expect(account).toContain("issuer");
    expect(getTableConfig(authUser).columns.map((column) => column.name)).not.toContain("accountId");
  });

  test("시각 열은 timezone을 갖는다", () => {
    // 허용된 차이로 문서화한 선택이다. 세션 만료 판정이 서버 지역시간에 흔들리지 않게 한다.
    for (const table of Object.values(authProviderTables)) {
      for (const column of getTableConfig(table).columns) {
        if (column.columnType !== "PgTimestamp") continue;
        expect(column.getSQLType(), `${getTableConfig(table).name}.${column.name}`)
          .toBe("timestamp with time zone");
      }
    }
  });
});
