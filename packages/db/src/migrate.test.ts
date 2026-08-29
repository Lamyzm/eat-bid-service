import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertSchemaVersion,
  createMigrationClient,
  migrationClientOptions,
  migrationFolder,
  migrationLockTimeoutMs,
  migrationStatementTimeoutMs,
  requireDatabaseUrl,
  runMigration,
  runMigrationCli,
} from "./migrate";
import { expectedMigration, expectedMigrationTimestamp } from "./version";

type JournalRow = {
  id: number;
  name: string | null;
  created_at: number | string | null;
};

function journalDatabase(...rows: JournalRow[]) {
  return {
    execute: async () => rows,
  };
}

describe("database URL", () => {
  test("rejects a missing DATABASE_URL before connecting", () => {
    expect(() => requireDatabaseUrl(undefined)).toThrow("DATABASE_URL is required");
  });

  test("rejects a malformed DATABASE_URL before connecting", () => {
    expect(() => requireDatabaseUrl("not a URL")).toThrow("valid PostgreSQL URL");
  });

  test("rejects a non-PostgreSQL DATABASE_URL before connecting", () => {
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
  ])("rejects hostless or database-less PostgreSQL URL %s", (value) => {
    expect(() => requireDatabaseUrl(value)).toThrow("valid PostgreSQL URL");
  });

  test("accepts both PostgreSQL URL schemes", () => {
    expect(requireDatabaseUrl("postgres://user:pass@db.example.com:5432/eatbid")).toBe(
      "postgres://user:pass@db.example.com:5432/eatbid",
    );
    expect(requireDatabaseUrl("postgresql://user:pass@[::1]:5432/eatbid?sslmode=require")).toBe(
      "postgresql://user:pass@[::1]:5432/eatbid?sslmode=require",
    );
  });
});

describe("migration folder", () => {
  test("resolves from the module instead of the current working directory", () => {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));

    expect(migrationFolder).toBe(resolve(moduleDirectory, "../drizzle"));
  });
});

describe("migration database session", () => {
  test("configures bounded lock and statement timeouts on the actual postgres-js client", async () => {
    expect(migrationLockTimeoutMs).toBe(5_000);
    expect(migrationStatementTimeoutMs).toBe(300_000);
    expect(migrationClientOptions).toEqual({
      max: 1,
      connection: {
        application_name: "eatbid-migrator",
        lock_timeout: 5_000,
        statement_timeout: 300_000,
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

describe("schema journal", () => {
  test("rejects an empty journal", async () => {
    await expect(assertSchemaVersion(journalDatabase(), expectedMigration)).rejects.toThrow(
      "journal is empty",
    );
  });

  test("rejects a journal behind the expected migration", async () => {
    await expect(
      assertSchemaVersion(
        journalDatabase({
          id: 3,
          name: "20260829001000_core_identity",
          created_at: Date.UTC(2026, 7, 29, 0, 10, 0),
        }),
        expectedMigration,
      ),
    ).rejects.toThrow("behind");
  });

  test("accepts the exact expected name and timestamp", async () => {
    await expect(
      assertSchemaVersion(
        journalDatabase({
          id: 4,
          name: expectedMigration,
          created_at: String(expectedMigrationTimestamp),
        }),
        expectedMigration,
      ),
    ).resolves.toBeUndefined();
  });

  test("rejects an unknown journal ahead of the code", async () => {
    await expect(
      assertSchemaVersion(
        journalDatabase({
          id: 5,
          name: "20260829002000_unknown_future",
          created_at: Date.UTC(2026, 7, 29, 0, 20, 0),
        }),
        expectedMigration,
      ),
    ).rejects.toThrow("ahead");
  });

  test("rejects a different name with the expected timestamp", async () => {
    await expect(
      assertSchemaVersion(
        journalDatabase({
          id: 5,
          name: "20260829001500_wrong_name",
          created_at: expectedMigrationTimestamp,
        }),
        expectedMigration,
      ),
    ).rejects.toThrow("does not match");
  });
});

describe("migration runner", () => {
  test("validates the URL before creating a client", async () => {
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
    "rejects %s before creating a client",
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

  test("migrates, verifies, and only then seeds", async () => {
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

  test("closes the client and skips seeds when version assertion fails", async () => {
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

  test("closes the client when a migration statement times out", async () => {
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

describe("migration CLI", () => {
  test("returns a nonzero exit code and reports migration failures", async () => {
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

  test("returns zero after a successful migration", async () => {
    const errors: unknown[] = [];

    expect(await runMigrationCli(async () => {}, (error) => errors.push(error))).toBe(0);
    expect(errors).toEqual([]);
  });
});
