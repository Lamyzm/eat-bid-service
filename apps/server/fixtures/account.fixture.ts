/**
 * @module 책임: 계정 통합 검사가 쓰는 일회용 PostgreSQL과 core 대조 fixture, 그리고 실패를 숨기지 않는
 * container 정리 확인을 한 곳에서 빌려준다.
 *
 * 정리 확인을 여기서 감싸는 이유: 공용 fixture는 본문이 성공한 실행에서만 정리를 확인한다(EAT-114).
 * 그 부채를 이 변경에서 고치지는 않되 기대지도 않으려면, 본문 실패 여부와 무관하게 소유 container를
 * 확인하고 원래 오류와 정리 오류를 둘 다 남겨야 한다.
 */
import { expect } from "bun:test";
import { disposableDatabase } from "./disposable-database.fixture";

/** 공개된 법인 사업자등록번호다. 원본이 관측했다고 가정할 때 정확 대조에 쓴다. */
export const observedBusinessNumber = "1248100998";
/** 같은 번호를 하이픈 표기로도 관측한 경우를 만든다. 두 표기가 다른 party면 대조는 실패해야 한다. */
export const observedBusinessNumberHyphenated = "124-81-00998";
/** 아직 원본에 없는 번호다. 등록은 성공하고 미연결로 보존돼야 한다. */
export const unobservedBusinessNumber = "2208162517";

export const linkedSupplierPartyId = 9007199254740995n;
export const rivalSupplierPartyId = 9007199254740997n;

const seedSql = `
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (9007199254740993, 'eat:business-number', 'eat', 'source-versioned', 'observed');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value
  values (9007199254740994, 9007199254740993, '${observedBusinessNumber}');
  insert into core.supplier_party (supplier_party_id, type, business_number_code_value_id)
  overriding system value
  values (${linkedSupplierPartyId}, 'company', 9007199254740994);
`;

export const accountDatabase = disposableDatabase({
  task: "eat47-account",
  migrationApplyCount: 1,
  seed: async (owner) => {
    await owner.unsafe(seedSql);
  },
});

/**
 * 본문과 정리를 모두 실행하고 둘 중 하나라도 실패하면 그 사실을 그대로 드러낸다. 둘 다 실패하면 원래
 * 오류를 정리 오류로 덮지 않는다.
 */
export async function withAccountDatabase<A>(
  work: Parameters<typeof accountDatabase.withDatabase<A>>[0],
): Promise<A> {
  let result: A | undefined;
  let bodyFailure: unknown;
  try {
    result = await accountDatabase.withDatabase(work);
  } catch (error) {
    bodyFailure = error;
  }
  let cleanupFailure: unknown;
  try {
    await accountDatabase.expectOwnedContainersCleanedUp();
  } catch (error) {
    cleanupFailure = error;
  }
  if (bodyFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError([bodyFailure, cleanupFailure], "검사 본문과 container 정리가 모두 실패했습니다.");
  }
  if (bodyFailure !== undefined) throw bodyFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
  return result as A;
}

export async function expectNoCoreWrites(
  owner: Parameters<typeof expectCounts>[0],
  work: () => Promise<unknown>,
): Promise<void> {
  const before = await expectCounts(owner);
  await work();
  expect(await expectCounts(owner)).toEqual(before);
}

async function expectCounts(owner: {
  unsafe: (query: string) => Promise<Array<Record<string, unknown>>>;
}): Promise<Record<string, unknown>> {
  const [row] = await owner.unsafe(`
    select
      (select count(*) from core.supplier_party) as supplier_party,
      (select count(*) from core.code_value) as code_value,
      (select count(*) from core.code_scheme) as code_scheme,
      (select count(*) from ingest.raw_observation) as raw_observation
  `);
  return row ?? {};
}
