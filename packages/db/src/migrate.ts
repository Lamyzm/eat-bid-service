import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { minutes, seconds, toMilliseconds } from "@eatbid/domain";

import { seedCodeSchemes } from "./seeds/code-schemes.js";
import {
  expectedMigration,
  migrationJournalInstant,
  migrationNameInstant,
} from "./version.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const migrationFolder = resolve(moduleDirectory, "../drizzle");

export const migrationLockTimeout = seconds(5);
export const migrationStatementTimeout = minutes(5);

export const migrationClientOptions = {
  max: 1,
  connection: {
    application_name: "eatbid-migrator",
    lock_timeout: toMilliseconds(migrationLockTimeout),
    statement_timeout: toMilliseconds(migrationStatementTimeout),
  },
} satisfies NonNullable<Parameters<typeof postgres>[1]>;

type JournalRow = {
  id: bigint;
  name: string | null;
  created_at: bigint | string | null;
};

export type SchemaVersionDatabase = {
  execute: (query: SQL) => Promise<unknown>;
};

export function requireDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("DATABASE_URL is required");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  const isPostgreSql = url.protocol === "postgres:" || url.protocol === "postgresql:";
  const hasAuthority = url.hostname.length > 0;
  const hasDatabase = url.pathname.startsWith("/") && url.pathname.length > 1;

  if (!isPostgreSql || !hasAuthority || !hasDatabase) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  return value;
}

export function createMigrationClient(databaseUrl: string): ReturnType<typeof postgres> {
  return postgres(databaseUrl, migrationClientOptions);
}

export async function assertSchemaVersion(
  database: SchemaVersionDatabase,
  expected: string,
): Promise<void> {
  const rows = (await database.execute(sql`
    select id, name, created_at
    from drizzle.__drizzle_migrations
    order by created_at desc, id desc
    limit 1
  `)) as JournalRow[];
  const latest = rows[0];

  if (!latest) {
    throw new Error("Drizzle migration journal is empty");
  }

  const expectedInstant = migrationNameInstant(expected);
  let actualInstant;
  try {
    actualInstant = migrationJournalInstant(latest.created_at);
  } catch {
    throw new Error(`Latest migration ${latest.name ?? "<unnamed>"} has an invalid timestamp`);
  }
  const order = actualInstant.epochNanoseconds < expectedInstant.epochNanoseconds
    ? -1
    : actualInstant.epochNanoseconds > expectedInstant.epochNanoseconds ? 1 : 0;
  if (order < 0) {
    throw new Error(`Database schema is behind: expected ${expected}, found ${latest.name ?? "<unnamed>"}`);
  }
  if (order > 0) {
    throw new Error(`Database schema is ahead: expected ${expected}, found ${latest.name ?? "<unnamed>"}`);
  }
  if (latest.name !== expected) {
    throw new Error(
      `Database migration name does not match timestamp: expected ${expected}, found ${latest.name ?? "<unnamed>"}`,
    );
  }
}

type MigrationConnection<TDatabase> = {
  database: TDatabase;
  close: () => Promise<void>;
};

export type MigrationRunOptions<TDatabase> = {
  databaseUrl: string | undefined;
  connect: (databaseUrl: string) => Promise<MigrationConnection<TDatabase>>;
  applyMigrations: (database: TDatabase, folder: string) => Promise<void>;
  assertVersion: (database: TDatabase, expected: string) => Promise<void>;
  seed: (database: TDatabase) => Promise<void>;
  log: (message: string) => void;
};

export async function runMigration<TDatabase>(options: MigrationRunOptions<TDatabase>): Promise<void> {
  const databaseUrl = requireDatabaseUrl(options.databaseUrl);
  const connection = await options.connect(databaseUrl);

  try {
    await options.applyMigrations(connection.database, migrationFolder);
    await options.assertVersion(connection.database, expectedMigration);
    await options.seed(connection.database);
    options.log(`Applied migration ${expectedMigration}`);
  } finally {
    await connection.close();
  }
}

export async function migrate(): Promise<void> {
  await runMigration({
    databaseUrl: process.env.DATABASE_URL,
    connect: async (databaseUrl) => {
      const client = createMigrationClient(databaseUrl);
      return {
        database: drizzle({ client }),
        close: async () => client.end(),
      };
    },
    applyMigrations: async (database, folder) => {
      const result = await drizzleMigrate(database, { migrationsFolder: folder });
      if (result) {
        throw new Error(`Drizzle migrator initialization failed: ${result.exitCode}`);
      }
    },
    assertVersion: async (database, expected) => assertSchemaVersion(database, expected),
    seed: async (database) => seedCodeSchemes(database),
    log: console.log,
  });
}

export async function runMigrationCli(
  run: () => Promise<void> = migrate,
  writeError: (error: unknown) => void = console.error,
): Promise<number> {
  try {
    await run();
    return 0;
  } catch (error) {
    writeError(error instanceof Error ? error.message : error);
    return 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint && resolve(entrypoint) === fileURLToPath(import.meta.url)) {
  void runMigrationCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
