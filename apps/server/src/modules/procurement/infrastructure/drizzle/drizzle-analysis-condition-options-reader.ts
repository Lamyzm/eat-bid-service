/**
 * @module 책임: 분석 조건 사전 port를 활성 회차 요약 build의 지역·품목·기관 건수 조회로 구현한다.
 *
 * 네 질의를 한 번에 보내는 이유는 시간축 어댑터와 같다 — 같은 조건의 답들이 서로 다른 순간을 보면
 * 조건 막대의 건수와 그림의 표본 수가 다른 build를 말하게 된다(ADR 0034).
 */
import { AUCTION_ITEM_ATOMS, CODE_SCHEME_NAMES, type AuctionItemAtom } from "@eatbid/contracts";
import type {
  AnalysisConditionOptionsQuery,
  AnalysisConditionOptionsReader,
  AnalysisConditionOptionsReading,
  AnalysisItemCountRecord,
  AnalysisOrganizationOptionRecord,
  AnalysisRegionCountRecord,
  AnalysisSelectedRegionRecord,
} from "../../application/analysis-condition-options-reader";
import type { AnalysisRegionScheme } from "../../application/analysis-time-series-reader";
import {
  analysisItemCountSql,
  analysisOrganizationOptionSql,
  analysisRegionUnobservedSql,
  analysisSelectedRegionSql,
  analysisSidoCountSql,
  analysisSigunguCountSql,
} from "./analysis-condition-options-query";
import type { AuctionReadDatabase } from "./drizzle-auction-reader";
import { ORG_ROUND_SUMMARY, readActiveMartBuildLineage } from "./drizzle-mart-build-reader";
import { bigintValue } from "./postgres-row-values";

type RegionRow = Readonly<{
  code_value_id: string | bigint | null;
  code: string | null;
  label: string | null;
  row_count: string | number | bigint;
}>;

type ItemRow = Readonly<{ item_code: string | null; row_count: string | number | bigint }>;

type SelectedRegionRow = Readonly<{
  code_value_id: string | bigint;
  code: string;
  label: string | null;
  parent_code_value_id: string | bigint | null;
}>;

type OrganizationRow = Readonly<{
  organization_id: string | bigint;
  organization_name: string | null;
  row_count: string | number | bigint;
  region_code_value_id: string | bigint | null;
  region_code: string | null;
  region_label: string | null;
}>;

function countOf(value: string | number | bigint): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError("Database analysis option count is invalid");
  }
  return count;
}

function rows<Row>(result: unknown): ReadonlyArray<Row> {
  return Array.isArray(result) ? result as ReadonlyArray<Row> : [];
}

/** 관측 라벨은 공백만 있는 문자열로도 온다. 그것을 이름으로 내보내면 화면에 빈 이름이 선다. */
function observedName(value: string | null): string | null {
  const name = value?.trim() ?? "";
  return name === "" ? null : name;
}

/**
 * 지역 행을 옮긴다. 목록은 사전에서 오므로 **건수가 0인 지역도 그대로 남는다** — 0건이라는 사실이
 * "이 조건으로는 여기 자료가 없다"는 판단의 재료다. 번역되지 않은 회차는 여기 없고 따로 센다
 * (어느 지역에 넣어도 그 지역의 수가 거짓이 된다, ADR 0035 결정 6).
 */
function mapRegionRows(
  read: ReadonlyArray<RegionRow>,
  scheme: AnalysisRegionScheme,
): readonly AnalysisRegionCountRecord[] {
  const regions: AnalysisRegionCountRecord[] = [];
  for (const row of read) {
    if (row.code_value_id === null || row.code === null) continue;
    regions.push({
      codeValueId: bigintValue(row.code_value_id),
      code: row.code,
      scheme,
      label: observedName(row.label),
      count: countOf(row.row_count),
    });
  }
  return regions;
}

/**
 * 원자 여덟을 어휘 순서로 전부 낸다. 질의에 안 나온 원자는 0이며, 0인 항목이 사라지면 사용자가 그
 * 품목이 이 조건에 없는지 어휘에 없는지 알 수 없다.
 */
function mapItemRows(read: ReadonlyArray<ItemRow>): {
  readonly items: readonly AnalysisItemCountRecord[];
  readonly unknown: number;
} {
  const counted = new Map<string, number>();
  let unknown = 0;
  for (const row of read) {
    const count = countOf(row.row_count);
    if (row.item_code === null) unknown += count;
    else counted.set(row.item_code, (counted.get(row.item_code) ?? 0) + count);
  }
  return {
    items: AUCTION_ITEM_ATOMS.map((atom: AuctionItemAtom) => ({ atom, count: counted.get(atom) ?? 0 })),
    unknown,
  };
}

/**
 * 고른 지역의 이름과 부모 시도다. 코드값이 사전에 없으면 `null`이며, 그때 화면은 이름 대신 "지역
 * 미확인"을 말한다 — 코드 숫자를 이름 자리에 적지 않는다(AGENTS 2·3).
 */
function mapSelectedRegion(
  row: SelectedRegionRow | undefined,
  scheme: AnalysisRegionScheme,
): AnalysisSelectedRegionRecord | null {
  if (row === undefined) return null;
  return {
    region: {
      codeValueId: bigintValue(row.code_value_id),
      code: row.code,
      scheme,
      label: observedName(row.label),
    },
    parentSidoCodeValueId: row.parent_code_value_id === null
      ? null
      : bigintValue(row.parent_code_value_id),
  };
}

function mapOrganizationRow(row: OrganizationRow): AnalysisOrganizationOptionRecord {
  const codeValueId = row.region_code_value_id;
  return {
    organizationId: bigintValue(row.organization_id),
    name: observedName(row.organization_name),
    region: codeValueId === null || row.region_code === null ? null : {
      codeValueId: bigintValue(codeValueId),
      code: row.region_code,
      scheme: CODE_SCHEME_NAMES.auctionLocationSigungu,
      label: observedName(row.region_label),
    },
    count: countOf(row.row_count),
  };
}

export class DrizzleAnalysisConditionOptionsReader implements AnalysisConditionOptionsReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async readConditionOptions(
    query: AnalysisConditionOptionsQuery,
  ): Promise<AnalysisConditionOptionsReading> {
    const scope = query.comparisonScope;
    const [sido, sigungu, unobserved, items, organizations, selected, lineage] = await Promise.all([
      this.database.execute(analysisSidoCountSql(query)),
      query.sido === null
        ? Promise.resolve([])
        : this.database.execute(analysisSigunguCountSql(query, query.sido)),
      this.database.execute(analysisRegionUnobservedSql(query)),
      this.database.execute(analysisItemCountSql(query)),
      this.database.execute(analysisOrganizationOptionSql(query)),
      scope.kind === "national"
        ? Promise.resolve([])
        : this.database.execute(analysisSelectedRegionSql(scope.scheme, scope.codeValueId)),
      readActiveMartBuildLineage(this.database, ORG_ROUND_SUMMARY),
    ]);
    const sidoCounts = mapRegionRows(rows<RegionRow>(sido), CODE_SCHEME_NAMES.auctionLocationSido);
    const sigunguCounts = mapRegionRows(
      rows<RegionRow>(sigungu),
      CODE_SCHEME_NAMES.auctionLocationSigungu,
    );
    const unobservedCount = countOf(
      rows<{ row_count: string | number | bigint }>(unobserved)[0]?.row_count ?? 0,
    );
    const itemCounts = mapItemRows(rows<ItemRow>(items));
    const organizationRows = rows<OrganizationRow>(organizations);
    return {
      selectedRegion: scope.kind === "national"
        ? null
        : mapSelectedRegion(rows<SelectedRegionRow>(selected)[0], scope.scheme),
      sido: sidoCounts,
      sigungu: sigunguCounts,
      regionUnobservedCount: unobservedCount,
      items: itemCounts.items,
      itemUnknownCount: itemCounts.unknown,
      organizations: organizationRows.slice(0, query.organizationLimit).map(mapOrganizationRow),
      organizationsTruncated: organizationRows.length > query.organizationLimit,
      lineage,
    };
  }
}
