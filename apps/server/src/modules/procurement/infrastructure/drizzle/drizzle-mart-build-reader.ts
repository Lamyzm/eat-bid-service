/**
 * @module 책임: mart 조회가 활성 build 하나만 읽도록 하는 SQL 조각과 그 build의 계보 행 매핑을 소유한다.
 *
 * mart 셋이 같은 조회를 쓰므로 회차 이력 어댑터가 이것을 혼자 갖지 않는다.
 */
import { sql, type SQL } from "drizzle-orm";
import { martCoverageSchema, type MartCoverage } from "@eatbid/contracts";
import type { MartBuildLineage } from "../../application/mart-build-lineage";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import { bigintValue } from "./postgres-row-values";

// `mart.build`의 partial unique index가 mart마다 활성 build를 하나로 강제하므로 이 하위 질의는
// 행을 하나 또는 0개만 돌려준다. 아직 빌드된 적이 없으면 null이고, 그때 목록은 비어야 한다.
// 빈 목록은 오류가 아니라 파생물이 아직 만들어지지 않은 정상 상태다(ADR 0011, ADR 0034).
export function activeMartBuildId(martName: string): SQL {
  return sql`(select active.build_id from mart.build as active
              where active.mart_name = ${martName} and active.status = 'active')`;
}

type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

type MartBuildLineageRow = Readonly<{
  build_id: string | bigint;
  source_release_id: string;
  calc_version: string;
  computed_at: PostgresTimestamp;
  region_scheme: string | null;
  coverage: string | null;
}>;

/**
 * 나쁜 순서다. 코호트에 여러 행이 걸리면 화면은 가장 나쁜 값을 봐야 하며, 판정 순서가 여러 조회에
 * 흩어지면 같은 build가 조회마다 다른 보유율을 낸다. 열을 인자로 받는 이유는 분포 조회가 별칭 붙은
 * 열로 같은 순서를 다시 쓰기 때문이다.
 */
export function worstCoverageOrder(column: SQL): SQL {
  return sql`
    case ${column}
      when 'none' then 0
      when 'unknown' then 1
      when 'partial' then 2
      else 3
    end
  `;
}

const WORST_COVERAGE_ORDER = worstCoverageOrder(sql`coverage`);

export function coverageValue(value: string | null): MartCoverage | null {
  if (value === null) return null;
  const parsed = martCoverageSchema.safeParse(value);
  // 계약이 모르는 보유율 값은 화면이 해석할 수 없다. 조용히 complete로 떨어뜨리는 대신 끊는다.
  if (!parsed.success) throw new TypeError(`Database mart coverage ${value} is not a known verdict`);
  return parsed.data;
}

export async function readActiveMartBuildLineage(
  database: AuctionReadDatabase,
  martName: string,
): Promise<MartBuildLineage | null> {
  const result = await database.execute(sql`
    select
      build.build_id,
      build.source_release_id,
      build.calc_version,
      build.computed_at,
      build.region_scheme,
      (select worst.coverage
         from mart.build_coverage worst
        where worst.build_id = build.build_id
        order by ${WORST_COVERAGE_ORDER}
        limit 1) as coverage
    from mart.build build
    where build.mart_name = ${martName} and build.status = 'active'
  `);
  const rows = Array.isArray(result) ? result as ReadonlyArray<MartBuildLineageRow> : [];
  const row = rows[0];
  if (row === undefined) return null;
  const computedAt = postgresInstant(row.computed_at);
  // `status = 'active'`는 `computed_at is not null`을 이미 요구한다. 그래도 없으면 계보가 깨진 것이다.
  if (computedAt === null) throw new TypeError("Active mart build has no computed timestamp");
  return {
    buildId: bigintValue(row.build_id),
    sourceReleaseId: row.source_release_id,
    calcVersion: row.calc_version,
    computedAt,
    coverage: coverageValue(row.coverage),
    regionScheme: row.region_scheme,
  };
}
