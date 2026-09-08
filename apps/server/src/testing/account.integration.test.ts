import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { maxRegisteredBusinesses } from "@eatbid/contracts";
import {
  DrizzleAccountRepository,
  isUniqueViolation,
  type AccountDatabase,
} from "../modules/account/infrastructure/drizzle/drizzle-account-repository";
import {
  accountDatabase,
  expectNoCoreWrites,
  linkedSupplierPartyId,
  observedBusinessNumber,
  observedBusinessNumberHyphenated,
  rivalSupplierPartyId,
  unobservedBusinessNumber,
  withAccountDatabase,
} from "../../fixtures/account.fixture";

const workspaceName = "내 워크스페이스";

async function counts(owner: { unsafe: (query: string) => Promise<Array<Record<string, unknown>>> }) {
  const [row] = await owner.unsafe(`
    select
      (select count(*) from app.principal) as principal,
      (select count(*) from app.identity_subject) as identity_subject,
      (select count(*) from app.workspace) as workspace,
      (select count(*) from app.workspace_membership) as membership,
      (select count(*) from app.principal_default_workspace) as default_workspace,
      (select count(*) from app.registered_business) as registered_business
  `);
  return Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]));
}

describe("계정 초기화와 등록 사업자 저장", () => {
  test("초기화는 멱등하고 조회는 어떤 행도 만들지 않는다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const repository = new DrizzleAccountRepository(drizzle({ client: api }) as unknown as AccountDatabase);

      const first = await repository.initializeAccount({ subject: "user-1", workspaceName });
      const second = await repository.initializeAccount({ subject: "user-1", workspaceName });

      expect(second.principalId).toBe(first.principalId);
      expect(second.workspace.workspaceId).toBe(first.workspace.workspaceId);
      expect(second.workspace.role).toBe("owner");
      expect(await counts(owner)).toMatchObject({
        principal: 1,
        identity_subject: 1,
        workspace: 1,
        membership: 1,
        default_workspace: 1,
      });

      const before = await counts(owner);
      expect(await repository.findPrincipalBySubject("user-1")).not.toBeNull();
      expect(await repository.findPrincipalBySubject("nobody")).toBeNull();
      expect(await counts(owner)).toEqual(before);
    });
  }, 180_000);

  test("같은 subject의 동시 초기화가 워크스페이스를 하나만 만들고 고아를 남기지 않는다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const repository = new DrizzleAccountRepository(drizzle({ client: api }) as unknown as AccountDatabase);

      const settled = await Promise.all([
        repository.initializeAccount({ subject: "race", workspaceName }),
        repository.initializeAccount({ subject: "race", workspaceName }),
        repository.initializeAccount({ subject: "race", workspaceName }),
      ]);

      const workspaceIds = new Set(settled.map((principal) => principal.workspace.workspaceId));
      expect(workspaceIds.size).toBe(1);
      // 재시도 판정이 실제 driver 오류 모양을 읽는지 같은 연결에서 확인한다. 이 판별이 틀리면 경쟁에서
      // 진 요청이 재시도 대신 의존성 장애가 된다.
      const database = drizzle({ client: api });
      let duplicate: unknown;
      try {
        await database.execute(sql`
          insert into app.identity_subject (principal_id, provider, issuer, subject)
          select principal_id, 'better-auth', 'urn:eatbid:auth', 'race' from app.principal limit 1
        `);
      } catch (error) {
        duplicate = error;
      }
      expect(duplicate).toBeDefined();
      expect(isUniqueViolation(duplicate)).toBe(true);
      // 경쟁에서 진 트랜잭션이 통째로 되돌아가야 주인 없는 principal도 워크스페이스도 남지 않는다.
      expect(await counts(owner)).toMatchObject({
        principal: 1,
        identity_subject: 1,
        workspace: 1,
        membership: 1,
        default_workspace: 1,
      });
    }, 180_000);
  }, 180_000);

  test("초기화가 principal까지만 만들고 끊긴 상태를 같은 command가 복구한다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const repository = new DrizzleAccountRepository(drizzle({ client: api }) as unknown as AccountDatabase);
      // app 저장이 도중에 끊긴 상태를 그대로 만든다. provider 계정은 있는데 워크스페이스가 없는 경우다.
      await owner.unsafe(`
        with created as (insert into app.principal default values returning principal_id)
        insert into app.identity_subject (principal_id, provider, issuer, subject)
        select principal_id, 'better-auth', 'urn:eatbid:auth', 'partial' from created
      `);

      expect(await repository.findPrincipalBySubject("partial")).toBeNull();
      const recovered = await repository.initializeAccount({ subject: "partial", workspaceName });

      expect(recovered.workspace.role).toBe("owner");
      expect(await counts(owner)).toMatchObject({ principal: 1, workspace: 1, default_workspace: 1 });
    });
  }, 180_000);
});

describe("사업자 등록의 소유와 대조", () => {
  test("같은 번호를 다른 워크스페이스가 등록할 수 있고 같은 워크스페이스의 중복만 막는다", async () => {
    await withAccountDatabase(async ({ api }) => {
      const repository = new DrizzleAccountRepository(drizzle({ client: api }) as unknown as AccountDatabase);
      const mine = await repository.initializeAccount({ subject: "mine", workspaceName });
      const rival = await repository.initializeAccount({ subject: "rival", workspaceName });

      const first = await repository.registerBusiness({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        businessNumber: observedBusinessNumber,
      });
      // 사업자등록번호는 공개 정보다. 전역 선점은 실사용자의 등록을 막는 서비스 거부이므로 두지 않는다.
      const other = await repository.registerBusiness({
        workspaceId: rival.workspace.workspaceId,
        principalId: rival.principalId,
        businessNumber: observedBusinessNumber,
      });
      const duplicate = await repository.registerBusiness({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        businessNumber: observedBusinessNumber,
      });

      expect(first.kind).toBe("registered");
      expect(other.kind).toBe("registered");
      expect(duplicate.kind).toBe("already-registered");
    });
  }, 180_000);

  test("미관측 번호도 등록되고 core에는 아무것도 쓰지 않는다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const repository = new DrizzleAccountRepository(drizzle({ client: api }) as unknown as AccountDatabase);
      const account = await repository.initializeAccount({ subject: "unobserved", workspaceName });

      await expectNoCoreWrites(owner, async () => {
        await repository.registerBusiness({
          workspaceId: account.workspace.workspaceId,
          principalId: account.principalId,
          businessNumber: unobservedBusinessNumber,
        });
      });

      const [business] = await repository.listBusinesses(account.workspace.workspaceId);
      expect(business?.supplierPartyId).toBeNull();
    });
  }, 180_000);

  test("나중에 원본이 그 사업자를 관측하면 같은 등록이 연결된다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const repository = new DrizzleAccountRepository(drizzle({ client: api }) as unknown as AccountDatabase);
      const account = await repository.initializeAccount({ subject: "later", workspaceName });
      await repository.registerBusiness({
        workspaceId: account.workspace.workspaceId,
        principalId: account.principalId,
        businessNumber: unobservedBusinessNumber,
      });
      expect((await repository.listBusinesses(account.workspace.workspaceId))[0]?.supplierPartyId).toBeNull();

      // 저장된 파생 FK가 없으므로 원본 관측 하나로 다음 조회가 저절로 연결된다.
      await owner.unsafe(`
        insert into core.code_value (code_value_id, code_scheme_id, code)
        overriding system value
        values (9007199254740996, 9007199254740993, '${unobservedBusinessNumber}');
        insert into core.supplier_party (supplier_party_id, type, business_number_code_value_id)
        overriding system value
        values (${rivalSupplierPartyId}, 'company', 9007199254740996);
      `);

      expect((await repository.listBusinesses(account.workspace.workspaceId))[0]?.supplierPartyId)
        .toBe(rivalSupplierPartyId);
    });
  }, 180_000);

  test("한 번호가 서로 다른 party 둘을 가리키면 임의로 고르지 않고 실패한다", async () => {
    await withAccountDatabase(async ({ api, owner }) => {
      const repository = new DrizzleAccountRepository(drizzle({ client: api }) as unknown as AccountDatabase);
      const account = await repository.initializeAccount({ subject: "ambiguous", workspaceName });
      await repository.registerBusiness({
        workspaceId: account.workspace.workspaceId,
        principalId: account.principalId,
        businessNumber: observedBusinessNumber,
      });
      // 원본이 같은 사업자를 하이픈 표기로도 관측하고 그 code value가 다른 party에 붙은 상태다.
      // 자동 병합은 명시적 reconciliation의 몫이라 조회는 하나를 고르지 않는다(ADR 0033 §1).
      await owner.unsafe(`
        insert into core.code_value (code_value_id, code_scheme_id, code)
        overriding system value
        values (9007199254740998, 9007199254740993, '${observedBusinessNumberHyphenated}');
        insert into core.supplier_party (supplier_party_id, type, business_number_code_value_id)
        overriding system value
        values (${rivalSupplierPartyId}, 'company', 9007199254740998);
      `);

      expect(repository.listBusinesses(account.workspace.workspaceId)).rejects.toThrow();
    });
  }, 180_000);

  test("활성 등록 상한을 넘기지 않는다", async () => {
    await withAccountDatabase(async ({ api }) => {
      const repository = new DrizzleAccountRepository(drizzle({ client: api }) as unknown as AccountDatabase);
      const account = await repository.initializeAccount({ subject: "many", workspaceName });
      // 상한을 넘겨 저장하면 그 다음 목록 조회가 응답 계약에서 깨진다. 등록 시점에 닫는다.
      for (let index = 0; index < maxRegisteredBusinesses; index += 1) {
        const number = `${String(1_000_000_000 + index).padStart(10, "0")}`;
        const result = await repository.registerBusiness({
          workspaceId: account.workspace.workspaceId,
          principalId: account.principalId,
          businessNumber: number,
        });
        expect(result.kind, number).toBe("registered");
      }

      const overflow = await repository.registerBusiness({
        workspaceId: account.workspace.workspaceId,
        principalId: account.principalId,
        businessNumber: observedBusinessNumber,
      });

      expect(overflow.kind).toBe("limit-reached");
      expect((await repository.listBusinesses(account.workspace.workspaceId)).length)
        .toBe(maxRegisteredBusinesses);
    });
  }, 300_000);
});

describe("위치 저장의 소유 경계", () => {
  test("위치를 저장·재설정·삭제하고 남의 등록과 없는 등록을 구분한다", async () => {
    await withAccountDatabase(async ({ api }) => {
      const repository = new DrizzleAccountRepository(drizzle({ client: api }) as unknown as AccountDatabase);
      const mine = await repository.initializeAccount({ subject: "owner", workspaceName });
      const rival = await repository.initializeAccount({ subject: "stranger", workspaceName });
      const registered = await repository.registerBusiness({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        businessNumber: observedBusinessNumber,
      });
      if (registered.kind !== "registered") throw new Error("등록이 성공해야 합니다");
      const businessId = registered.business.registeredBusinessId;
      expect(registered.business.location).toBeNull();
      expect(registered.business.supplierPartyId).toBe(linkedSupplierPartyId);

      const saved = await repository.changeLocation({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        registeredBusinessId: businessId,
        addressText: "서울특별시 중구 세종대로 110",
      });
      const rewritten = await repository.changeLocation({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        registeredBusinessId: businessId,
        addressText: "경기도 성남시 분당구",
      });
      const cleared = await repository.changeLocation({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        registeredBusinessId: businessId,
        addressText: null,
      });

      expect(saved.kind === "changed" && saved.business.location?.addressText)
        .toBe("서울특별시 중구 세종대로 110");
      expect(rewritten.kind === "changed" && rewritten.business.location?.addressText)
        .toBe("경기도 성남시 분당구");
      // 미설정은 빈 문자열이 아니라 값이 없는 상태다.
      expect(cleared.kind === "changed" && cleared.business.location).toBeNull();

      const stranger = await repository.changeLocation({
        workspaceId: rival.workspace.workspaceId,
        principalId: rival.principalId,
        registeredBusinessId: businessId,
        addressText: "남의 사업장",
      });
      const missing = await repository.changeLocation({
        workspaceId: mine.workspace.workspaceId,
        principalId: mine.principalId,
        registeredBusinessId: 9223372036854775807n,
        addressText: "없는 등록",
      });

      expect(stranger.kind).toBe("forbidden");
      expect(missing.kind).toBe("not-found");
      expect(await repository.listBusinesses(rival.workspace.workspaceId)).toEqual([]);
    });
  }, 180_000);
});
