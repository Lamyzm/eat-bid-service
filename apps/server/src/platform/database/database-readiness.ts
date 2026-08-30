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
  is_login: boolean;
  inherits_privileges: boolean;
  can_create_role: boolean;
  can_create_database: boolean;
  can_replicate: boolean;
  bypasses_rls: boolean;
  has_role_membership: boolean;
  can_set_role: boolean;
  owns_database: boolean;
  can_connect_database: boolean;
  can_create_in_database: boolean;
  can_temp_in_database: boolean;
  can_use_core: boolean;
  can_use_mart: boolean;
  can_use_app: boolean;
  can_use_ingest: boolean;
  can_use_drizzle: boolean;
  can_create_core: boolean;
  can_create_mart: boolean;
  can_create_app: boolean;
  can_create_ingest: boolean;
  can_create_drizzle: boolean;
  can_create_public: boolean;
  owns_relevant_objects: boolean;
  can_read_core: boolean;
  has_forbidden_core_table_privilege: boolean;
  can_read_mart: boolean;
  has_forbidden_mart_table_privilege: boolean;
  has_required_app_table_privileges: boolean;
  has_forbidden_app_table_privilege: boolean;
  has_sequence_privilege: boolean;
  has_ingest_table_privilege: boolean;
  can_read_migrations: boolean;
  has_forbidden_drizzle_table_privilege: boolean;
  has_public_table_privilege: boolean;
}>;

const readinessQuery = sql`
  select
    migration.name as migration_name,
    migration.created_at as migration_created_at,
    role.rolsuper as is_superuser,
    role.rolcanlogin as is_login,
    role.rolinherit as inherits_privileges,
    role.rolcreaterole as can_create_role,
    role.rolcreatedb as can_create_database,
    role.rolreplication as can_replicate,
    role.rolbypassrls as bypasses_rls,
    exists (
      select 1
      from pg_roles candidate
      where candidate.oid <> role.oid
        and pg_has_role(role.oid, candidate.oid, 'MEMBER')
    ) as has_role_membership,
    exists (
      select 1
      from pg_roles candidate
      where candidate.oid <> role.oid
        and pg_has_role(role.oid, candidate.oid, 'SET')
    ) as can_set_role,
    pg_get_userbyid(database.datdba) = current_user as owns_database,
    has_database_privilege(current_user, current_database(), 'CONNECT') as can_connect_database,
    has_database_privilege(current_user, current_database(), 'CREATE') as can_create_in_database,
    has_database_privilege(current_user, current_database(), 'TEMP') as can_temp_in_database,
    has_schema_privilege(current_user, 'core', 'USAGE') as can_use_core,
    has_schema_privilege(current_user, 'mart', 'USAGE') as can_use_mart,
    has_schema_privilege(current_user, 'app', 'USAGE') as can_use_app,
    has_schema_privilege(current_user, 'ingest', 'USAGE') as can_use_ingest,
    has_schema_privilege(current_user, 'drizzle', 'USAGE') as can_use_drizzle,
    has_schema_privilege(current_user, 'core', 'CREATE') as can_create_core,
    has_schema_privilege(current_user, 'mart', 'CREATE') as can_create_mart,
    has_schema_privilege(current_user, 'app', 'CREATE') as can_create_app,
    has_schema_privilege(current_user, 'ingest', 'CREATE') as can_create_ingest,
    has_schema_privilege(current_user, 'drizzle', 'CREATE') as can_create_drizzle,
    has_schema_privilege(current_user, 'public', 'CREATE') as can_create_public,
    exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname in ('core', 'mart', 'app', 'ingest', 'drizzle', 'public')
        and relation.relowner = role.oid
    ) or exists (
      select 1
      from pg_proc routine
      join pg_namespace namespace on namespace.oid = routine.pronamespace
      where namespace.nspname in ('core', 'mart', 'app', 'ingest', 'drizzle', 'public')
        and routine.proowner = role.oid
    ) or exists (
      select 1
      from pg_type owned_type
      join pg_namespace namespace on namespace.oid = owned_type.typnamespace
      where namespace.nspname in ('core', 'mart', 'app', 'ingest', 'drizzle', 'public')
        and owned_type.typowner = role.oid
    ) as owns_relevant_objects,
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
        and (
          has_table_privilege(
            current_user,
            relation.oid,
            'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
          or has_any_column_privilege(current_user, relation.oid, 'INSERT')
          or has_any_column_privilege(current_user, relation.oid, 'UPDATE')
          or has_any_column_privilege(current_user, relation.oid, 'REFERENCES')
        )
    ) as has_forbidden_core_table_privilege,
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
        and (
          has_table_privilege(
            current_user,
            relation.oid,
            'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
          or has_any_column_privilege(current_user, relation.oid, 'INSERT')
          or has_any_column_privilege(current_user, relation.oid, 'UPDATE')
          or has_any_column_privilege(current_user, relation.oid, 'REFERENCES')
        )
    ) as has_forbidden_mart_table_privilege,
    not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and not (
          has_table_privilege(current_user, relation.oid, 'SELECT')
          and has_table_privilege(current_user, relation.oid, 'INSERT')
          and has_table_privilege(current_user, relation.oid, 'UPDATE')
          and has_table_privilege(current_user, relation.oid, 'DELETE')
        )
    ) as has_required_app_table_privileges,
    exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and (
          has_table_privilege(current_user, relation.oid, 'TRUNCATE,REFERENCES,TRIGGER')
          or has_any_column_privilege(current_user, relation.oid, 'REFERENCES')
        )
    ) as has_forbidden_app_table_privilege,
    exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname in ('core', 'mart', 'app', 'ingest', 'drizzle', 'public')
        and relation.relkind = 'S'
        and has_sequence_privilege(current_user, relation.oid, 'USAGE,SELECT,UPDATE')
    ) as has_sequence_privilege,
    exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'ingest'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and (
          has_table_privilege(
            current_user,
            relation.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
          or has_any_column_privilege(current_user, relation.oid, 'SELECT')
          or has_any_column_privilege(current_user, relation.oid, 'INSERT')
          or has_any_column_privilege(current_user, relation.oid, 'UPDATE')
          or has_any_column_privilege(current_user, relation.oid, 'REFERENCES')
        )
    ) as has_ingest_table_privilege,
    has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'SELECT')
      as can_read_migrations,
    exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'drizzle'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and (
          has_table_privilege(current_user, relation.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or has_any_column_privilege(current_user, relation.oid, 'INSERT')
          or has_any_column_privilege(current_user, relation.oid, 'UPDATE')
          or has_any_column_privilege(current_user, relation.oid, 'REFERENCES')
          or relation.relname <> '__drizzle_migrations'
            and (
              has_table_privilege(current_user, relation.oid, 'SELECT')
              or has_any_column_privilege(current_user, relation.oid, 'SELECT')
            )
        )
    ) as has_forbidden_drizzle_table_privilege,
    exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p', 'v', 'm', 'f')
        and (
          has_table_privilege(
            current_user,
            relation.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
          or has_any_column_privilege(current_user, relation.oid, 'SELECT')
          or has_any_column_privilege(current_user, relation.oid, 'INSERT')
          or has_any_column_privilege(current_user, relation.oid, 'UPDATE')
          or has_any_column_privilege(current_user, relation.oid, 'REFERENCES')
        )
    ) as has_public_table_privilege
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
  // 단순 접속 성공이 아니라 정확한 migration과 API 역할의 최소 권한을 모두 만족해야 트래픽을 받는다.
  if (!row) return false;
  return row.migration_name === expectedMigration
    && Number(row.migration_created_at) === expectedMigrationTimestamp
    && !row.is_superuser
    && row.is_login
    && !row.inherits_privileges
    && !row.can_create_role
    && !row.can_create_database
    && !row.can_replicate
    && !row.bypasses_rls
    && !row.has_role_membership
    && !row.can_set_role
    && !row.owns_database
    && row.can_connect_database
    && !row.can_create_in_database
    && !row.can_temp_in_database
    && row.can_use_core
    && row.can_use_mart
    && row.can_use_app
    && !row.can_use_ingest
    && row.can_use_drizzle
    && !row.can_create_core
    && !row.can_create_mart
    && !row.can_create_app
    && !row.can_create_ingest
    && !row.can_create_drizzle
    && !row.can_create_public
    && !row.owns_relevant_objects
    && row.can_read_core
    && !row.has_forbidden_core_table_privilege
    && row.can_read_mart
    && !row.has_forbidden_mart_table_privilege
    && row.has_required_app_table_privileges
    && !row.has_forbidden_app_table_privilege
    && !row.has_sequence_privilege
    && !row.has_ingest_table_privilege
    && row.can_read_migrations
    && !row.has_forbidden_drizzle_table_privilege
    && !row.has_public_table_privilege;
}

export async function databaseReadinessProbe(
  database: ReadinessDatabase,
): Promise<Readonly<{ ready: boolean; row?: ReadinessRow }>> {
  try {
    const row = rowsOf(await database.execute(readinessQuery))[0];
    return { ready: isLeastPrivilegeReady(row), row };
  } catch {
    // 카탈로그나 migration 표를 읽지 못하는 상태도 준비 실패이며 내부 DB 정보를 응답에 노출하지 않는다.
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
