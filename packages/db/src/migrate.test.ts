import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { minutes, seconds, toMilliseconds } from "@eatbid/domain";

import {
  assertSchemaVersion,
  createMigrationClient,
  migrationClientOptions,
  migrationFolder,
  migrationLockTimeout,
  migrationStatementTimeout,
  requireDatabaseUrl,
  runMigration,
  runMigrationCli,
} from "./migrate";
import { expectedMigration } from "./version";

type JournalRow = {
  id: bigint;
  name: string | null;
  created_at: bigint | string | null;
};

function journalDatabase(...rows: JournalRow[]) {
  return {
    execute: async () => rows,
  };
}

describe("database URL 검증", () => {
  test("연결 전에 누락된 DATABASE_URL을 거부한다", () => {
    expect(() => requireDatabaseUrl(undefined)).toThrow("DATABASE_URL is required");
  });

  test("연결 전에 잘못된 DATABASE_URL을 거부한다", () => {
    expect(() => requireDatabaseUrl("not a URL")).toThrow("valid PostgreSQL URL");
  });

  test("연결 전에 PostgreSQL이 아닌 DATABASE_URL을 거부한다", () => {
    expect(() => requireDatabaseUrl("mysql://user:pass@db/eatbid")).toThrow(
      "valid PostgreSQL URL",
    );
  });

  test.each([
    "postgres:foo",
    "postgres://",
    "postgres:///eatbid",
    "postgres://db.example.com",
    "postgres://db.example.com/",
  ])("host나 database가 없는 PostgreSQL URL %s를 거부한다", (value) => {
    expect(() => requireDatabaseUrl(value)).toThrow("valid PostgreSQL URL");
  });

  test("두 PostgreSQL URL scheme을 모두 허용한다", () => {
    expect(requireDatabaseUrl("postgres://user:pass@db.example.com:5432/eatbid")).toBe(
      "postgres://user:pass@db.example.com:5432/eatbid",
    );
    expect(requireDatabaseUrl("postgresql://user:pass@[::1]:5432/eatbid?sslmode=require")).toBe(
      "postgresql://user:pass@[::1]:5432/eatbid?sslmode=require",
    );
  });
});

describe("migration folder 선택", () => {
  test("현재 working directory 대신 module 기준으로 경로를 해석한다", () => {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));

    expect(migrationFolder).toBe(resolve(moduleDirectory, "../drizzle"));
  });
});

describe("migration database session 경계", () => {
  test("실제 postgres-js client에 제한된 lock·statement timeout을 설정한다", async () => {
    expect(migrationLockTimeout).toBe(seconds(5));
    expect(migrationStatementTimeout).toBe(minutes(5));
    expect(migrationClientOptions).toEqual({
      max: 1,
      connection: {
        application_name: "eatbid-migrator",
        lock_timeout: toMilliseconds(seconds(5)),
        statement_timeout: toMilliseconds(minutes(5)),
      },
    });

    const client = createMigrationClient("postgres://user:pass@db.invalid/eatbid");
    try {
      expect(client.options.max).toBe(1);
      expect(client.options.connection).toMatchObject({
        application_name: "eatbid-migrator",
        lock_timeout: 5_000,
        statement_timeout: 300_000,
      });
    } finally {
      await client.end();
    }
  });
});

describe("schema journal 검증", () => {
  test("빈 journal을 거부한다", async () => {
    await expect(assertSchemaVersion(journalDatabase(), expectedMigration)).rejects.toThrow(
      "journal is empty",
    );
  });

  test("예상 migration보다 뒤처진 journal을 거부한다", async () => {
    await expect(
      assertSchemaVersion(
        journalDatabase({
          id: 4n,
          name: "20260829002000_ingest_lineage_manifests",
          created_at: "1787962800000",
        }),
        expectedMigration,
      ),
    ).rejects.toThrow("behind");
  });

  test("예상한 이름과 timestamp가 정확히 일치할 때만 허용한다", async () => {
    await expect(
      assertSchemaVersion(
        journalDatabase({
          id: 5n,
          name: expectedMigration,
          created_at: "1788245348000",
        }),
        expectedMigration,
      ),
    ).resolves.toBeUndefined();
  });

  test("code보다 앞선 알 수 없는 journal을 거부한다", async () => {
    await expect(
      assertSchemaVersion(
        journalDatabase({
          id: 6n,
          name: "20260901065000_unknown_future",
          created_at: "1788245400000",
        }),
        expectedMigration,
      ),
    ).rejects.toThrow("ahead");
  });

  test("예상 timestamp와 다른 이름을 거부한다", async () => {
    await expect(
      assertSchemaVersion(
        journalDatabase({
          id: 6n,
          name: "20260901064908_wrong_name",
          created_at: "1788245348000",
        }),
        expectedMigration,
      ),
    ).rejects.toThrow("does not match");
  });
});

describe("migration runner 수명주기", () => {
  test("client 생성 전에 URL을 검증한다", async () => {
    let connected = false;

    await expect(
      runMigration({
        databaseUrl: "sqlite:///tmp/eatbid.db",
        connect: async () => {
          connected = true;
          return { database: {}, close: async () => {} };
        },
        applyMigrations: async () => {},
        assertVersion: async () => {},
        seed: async () => {},
        log: () => {},
      }),
    ).rejects.toThrow("valid PostgreSQL URL");
    expect(connected).toBe(false);
  });

  test.each([
    "postgres:foo",
    "postgres://",
    "postgres:///eatbid",
    "postgres://db.example.com",
    "postgres://db.example.com/",
  ])(
    "client 생성 전에 %s를 거부한다",
    async (databaseUrl) => {
      let connected = false;

      await expect(
        runMigration({
          databaseUrl,
          connect: async () => {
            connected = true;
            return { database: {}, close: async () => {} };
          },
          applyMigrations: async () => {},
          assertVersion: async () => {},
          seed: async () => {},
          log: () => {},
        }),
      ).rejects.toThrow("valid PostgreSQL URL");
      expect(connected).toBe(false);
    },
  );

  test("migration과 검증을 마친 뒤에만 seed한다", async () => {
    const events: string[] = [];

    await runMigration({
      databaseUrl: "postgres://user:pass@db/eatbid",
      connect: async () => {
        events.push("connect");
        return {
          database: {},
          close: async () => {
            events.push("close");
          },
        };
      },
      applyMigrations: async (_database, folder) => {
        expect(folder).toBe(migrationFolder);
        events.push("migrate");
      },
      assertVersion: async (_database, expected) => {
        expect(expected).toBe(expectedMigration);
        events.push("assert");
      },
      seed: async () => {
        events.push("seed");
      },
      log: (message) => {
        expect(message).toContain(expectedMigration);
        events.push("log");
      },
    });

    expect(events).toEqual(["connect", "migrate", "assert", "seed", "log", "close"]);
  });

  test("version 검증이 실패하면 seed를 건너뛰고 client를 닫는다", async () => {
    const events: string[] = [];

    await expect(
      runMigration({
        databaseUrl: "postgres://user:pass@db/eatbid",
        connect: async () => ({
          database: {},
          close: async () => {
            events.push("close");
          },
        }),
        applyMigrations: async () => {
          events.push("migrate");
        },
        assertVersion: async () => {
          events.push("assert");
          throw new Error("schema mismatch");
        },
        seed: async () => {
          events.push("seed");
        },
        log: () => {
          events.push("log");
        },
      }),
    ).rejects.toThrow("schema mismatch");

    expect(events).toEqual(["migrate", "assert", "close"]);
  });

  test("migration statement가 timeout되면 client를 닫는다", async () => {
    const events: string[] = [];
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });

    await expect(
      runMigration({
        databaseUrl: "postgres://user:pass@db/eatbid",
        connect: async () => ({
          database: {},
          close: async () => {
            events.push("close");
          },
        }),
        applyMigrations: async () => {
          events.push("migrate");
          throw timeout;
        },
        assertVersion: async () => {
          events.push("assert");
        },
        seed: async () => {
          events.push("seed");
        },
        log: () => {
          events.push("log");
        },
      }),
    ).rejects.toBe(timeout);

    expect(events).toEqual(["migrate", "close"]);
  });
});

describe("migration CLI 경계", () => {
  test("migration 실패를 보고하고 0이 아닌 exit code를 반환한다", async () => {
    const errors: unknown[] = [];

    const exitCode = await runMigrationCli(
      async () => {
        throw new Error("migration timed out");
      },
      (error) => errors.push(error),
    );

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["migration timed out"]);
  });

  test("migration 성공 뒤 exit code 0을 반환한다", async () => {
    const errors: unknown[] = [];

    expect(await runMigrationCli(async () => {}, (error) => errors.push(error))).toBe(0);
    expect(errors).toEqual([]);
  });
});
