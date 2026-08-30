import { expectedMigration, expectedMigrationTimestamp } from "@eatbid/db";
import { sql, type SQL } from "drizzle-orm";
import type { DatabaseReadiness } from "../health/readiness-state";

export interface ReadinessDatabase {
  execute(query: SQL): Promise<unknown>;
}

export type ReadinessRow = Readonly<{
  migration_name: string | null;
  migration_created_at: string | number | null;
  is_superuser: boolean;
  can_create_role: boolean;
  can_create_database: boolean;
  owns_database: boolean;
  can_create_in_database: boolean;
  can_use_core: boolean;
  can_use_mart: boolean;
  can_use_app: boolean;
  can_use_ingest: boolean;
  can_create_core: boolean;
  can_create_mart: boolean;
  can_create_app: boolean;
  can_read_core: boolean;
  can_write_core: boolean;
  can_read_mart: boolean;
  can_write_mart: boolean;
  can_write_app: boolean;
  can_read_ingest: boolean;
  can_write_migrations: boolean;
}>;

const readinessQuery = sql`
  select
    migration.name as migration_name,
    migration.created_at as migration_created_at,
    role.rolsuper as is_superuser,
    role.rolcreaterole as can_create_role,
    role.rolcreatedb as can_create_database,
    pg_get_userbyid(database.datdba) = current_user as owns_database,
    has_database_privilege(current_user, current_database(), 'CREATE') as can_create_in_database,
    has_schema_privilege(current_user, 'core', 'USAGE') as can_use_core,
    has_schema_privilege(current_user, 'mart', 'USAGE') as can_use_mart,
    has_schema_privilege(current_user, 'app', 'USAGE') as can_use_app,
    has_schema_privilege(current_user, 'ingest', 'USAGE') as can_use_ingest,
    has_schema_privilege(current_user, 'core', 'CREATE') as can_create_core,
    has_schema_privilege(current_user, 'mart', 'CREATE') as can_create_mart,
    has_schema_privilege(current_user, 'app', 'CREATE') as can_create_app,
    not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'core'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and not has_table_privilege(current_user, relation.oid, 'SELECT')
    ) as can_read_core,
    exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'core'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_table_privilege(current_user, relation.oid, 'INSERT,UPDATE,DELETE')
    ) as can_write_core,
    not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'mart'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and not has_table_privilege(current_user, relation.oid, 'SELECT')
    ) as can_read_mart,
    exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'mart'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_table_privilege(current_user, relation.oid, 'INSERT,UPDATE,DELETE')
    ) as can_write_mart,
    has_table_privilege(current_user, 'app.principal', 'SELECT')
      and has_table_privilege(current_user, 'app.principal', 'INSERT')
      and has_table_privilege(current_user, 'app.principal', 'UPDATE')
      and has_table_privilege(current_user, 'app.principal', 'DELETE')
      and has_table_privilege(current_user, 'app.identity_subject', 'SELECT')
      and has_table_privilege(current_user, 'app.identity_subject', 'INSERT')
      and has_table_privilege(current_user, 'app.identity_subject', 'UPDATE')
      and has_table_privilege(current_user, 'app.identity_subject', 'DELETE')
      and has_table_privilege(current_user, 'app.workspace', 'SELECT')
      and has_table_privilege(current_user, 'app.workspace', 'INSERT')
      and has_table_privilege(current_user, 'app.workspace', 'UPDATE')
      and has_table_privilege(current_user, 'app.workspace', 'DELETE')
      and has_table_privilege(current_user, 'app.workspace_membership', 'SELECT')
      and has_table_privilege(current_user, 'app.workspace_membership', 'INSERT')
      and has_table_privilege(current_user, 'app.workspace_membership', 'UPDATE')
      and has_table_privilege(current_user, 'app.workspace_membership', 'DELETE') as can_write_app,
    coalesce(has_table_privilege(
      current_user,
      (select relation.oid
       from pg_class relation
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'ingest' and relation.relname = 'run'),
      'SELECT'
    ), false) as can_read_ingest,
    has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'INSERT,UPDATE,DELETE')
      as can_write_migrations
  from pg_roles role
  cross join pg_database database
  cross join lateral (
    select name, created_at
    from drizzle.__drizzle_migrations
    order by created_at desc, id desc
    limit 1
  ) migration
  where role.rolname = current_user
    and database.datname = current_database()
`;

function rowsOf(result: unknown): ReadinessRow[] {
  return Array.isArray(result) ? result as ReadinessRow[] : [];
}

function isLeastPrivilegeReady(row: ReadinessRow | undefined): boolean {
  if (!row) return false;
  return row.migration_name === expectedMigration
    && Number(row.migration_created_at) === expectedMigrationTimestamp
    && !row.is_superuser
    && !row.can_create_role
    && !row.can_create_database
    && !row.owns_database
    && !row.can_create_in_database
    && row.can_use_core
    && row.can_use_mart
    && row.can_use_app
    && !row.can_use_ingest
    && !row.can_create_core
    && !row.can_create_mart
    && !row.can_create_app
    && row.can_read_core
    && !row.can_write_core
    && row.can_read_mart
    && !row.can_write_mart
    && row.can_write_app
    && !row.can_read_ingest
    && !row.can_write_migrations;
}

export async function databaseReadinessProbe(
  database: ReadinessDatabase,
): Promise<Readonly<{ ready: boolean; row?: ReadinessRow }>> {
  try {
    const row = rowsOf(await database.execute(readinessQuery))[0];
    return { ready: isLeastPrivilegeReady(row), row };
  } catch {
    return { ready: false };
  }
}

export function createDatabaseReadiness(database: ReadinessDatabase): DatabaseReadiness {
  return {
    async isReady(): Promise<boolean> {
      return (await databaseReadinessProbe(database)).ready;
    },
  };
}
