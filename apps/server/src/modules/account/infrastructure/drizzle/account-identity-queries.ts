/**
 * @module 책임: provider subject를 bigint principal과 개인 워크스페이스로 해소하고 그 관계를 멱등하게 만든다.
 *
 * 초기화의 유일성을 애플리케이션 선검사로 지키지 않는 이유: 두 트랜잭션은 서로의 미커밋 행을 보지 못하므로
 * "없으면 만든다"는 검사는 동시 요청에서 둘 다 통과한다. 유일성은 제약이 판정하고 진 쪽은 통째로 되돌린다.
 */
import { sql } from "drizzle-orm";
import {
  AUTH_IDENTITY_ISSUER,
  AUTH_IDENTITY_PROVIDER,
} from "../../../../platform/auth/auth-identity";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import type { InitializeAccountInput } from "../../application/account-repository";
import { identifier, isUniqueViolation, rows, type AccountDatabase } from "./account-sql";

type PrincipalRow = Readonly<{
  principal_id: string | bigint;
  workspace_id: string | bigint;
  workspace_name: string;
  role: string;
}>;

function workspaceRole(value: string): "member" | "owner" {
  // 값의 권위는 계약 enum이고 DB check가 그 사본을 강제한다. 그래도 다른 값이 왔다면 제약이 사라진
  // 것이므로 기본 역할로 낮춰 통과시키지 않는다.
  if (value !== "member" && value !== "owner") throw new TypeError("Database workspace role is not supported");
  return value;
}

export async function readPrincipal(
  database: AccountDatabase,
  subject: string,
): Promise<ResolvedPrincipal | null> {
  const result = await database.execute(sql`
    select principal.principal_id,
           workspace.workspace_id,
           workspace.name as workspace_name,
           membership.role
    from app.identity_subject identity
    join app.principal principal on principal.principal_id = identity.principal_id
    join app.principal_default_workspace defaults on defaults.principal_id = principal.principal_id
    join app.workspace workspace on workspace.workspace_id = defaults.workspace_id
    join app.workspace_membership membership
      on membership.workspace_id = workspace.workspace_id
     and membership.principal_id = principal.principal_id
    where identity.provider = ${AUTH_IDENTITY_PROVIDER}
      and identity.issuer = ${AUTH_IDENTITY_ISSUER}
      and identity.subject = ${subject}
  `);
  const row = rows<PrincipalRow>(result)[0];
  return row
    ? {
      principalId: identifier(row.principal_id),
      workspace: {
        workspaceId: identifier(row.workspace_id),
        name: row.workspace_name,
        role: workspaceRole(row.role),
      },
    }
    : null;
}

async function resolveOrCreatePrincipal(
  transaction: AccountDatabase,
  subject: string,
): Promise<bigint> {
  const existing = rows<{ principal_id: string | bigint }>(await transaction.execute(sql`
    select principal_id
    from app.identity_subject
    where provider = ${AUTH_IDENTITY_PROVIDER}
      and issuer = ${AUTH_IDENTITY_ISSUER}
      and subject = ${subject}
  `))[0];
  if (existing) return identifier(existing.principal_id);

  const created = rows<{ principal_id: string | bigint }>(await transaction.execute(sql`
    insert into app.principal default values returning principal_id
  `))[0];
  if (!created) throw new TypeError("Principal insert returned no row");
  const principalId = identifier(created.principal_id);
  await transaction.execute(sql`
    insert into app.identity_subject (principal_id, provider, issuer, subject)
    values (${principalId}, ${AUTH_IDENTITY_PROVIDER}, ${AUTH_IDENTITY_ISSUER}, ${subject})
  `);
  return principalId;
}

async function ensureDefaultWorkspace(
  transaction: AccountDatabase,
  principalId: bigint,
  workspaceName: string,
): Promise<void> {
  const existing = rows<{ workspace_id: string | bigint }>(await transaction.execute(sql`
    select workspace_id from app.principal_default_workspace where principal_id = ${principalId}
  `))[0];
  if (existing) return;

  const created = rows<{ workspace_id: string | bigint }>(await transaction.execute(sql`
    insert into app.workspace (name) values (${workspaceName}) returning workspace_id
  `))[0];
  if (!created) throw new TypeError("Workspace insert returned no row");
  const workspaceId = identifier(created.workspace_id);
  await transaction.execute(sql`
    insert into app.workspace_membership (workspace_id, principal_id, role)
    values (${workspaceId}, ${principalId}, 'owner')
  `);
  await transaction.execute(sql`
    insert into app.principal_default_workspace (principal_id, workspace_id)
    values (${principalId}, ${workspaceId})
  `);
}

/**
 * 두 단계 모두 멱등하다. identity가 없으면 principal과 identity를 만들고, 기본 워크스페이스가 없으면
 * 워크스페이스·owner membership·기본 관계를 만든다. 두 unique 제약 중 하나라도 경쟁에서 지면 트랜잭션
 * 전체가 되돌아가므로 주인 없는 principal도 워크스페이스도 남지 않고, 그때는 이긴 쪽이 이미 커밋돼
 * 있으므로 한 번 더 읽으면 끝난다.
 */
export async function initializeAccount(
  database: AccountDatabase,
  input: InitializeAccountInput,
): Promise<ResolvedPrincipal> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await database.transaction(async (transaction) => {
        const principalId = await resolveOrCreatePrincipal(transaction, input.subject);
        await ensureDefaultWorkspace(transaction, principalId, input.workspaceName);
        const principal = await readPrincipal(transaction, input.subject);
        if (principal === null) throw new TypeError("Account initialization did not produce a workspace");
        return principal;
      });
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 1) throw error;
    }
  }
  throw new TypeError("Account initialization did not settle");
}
