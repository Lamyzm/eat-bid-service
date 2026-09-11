/**
 * @module 책임: 참가제한지역 목록·미리보기 port를 코드 목록 질의와 오늘·과거 창 두 조회의 행 매핑으로
 * 구현한다.
 */
import type {
  EligibilityAreaCatalog,
  EligibilityAreaGroupRecord,
  EligibilityAreaReader,
  RegionCoverageQuery,
  RegionCoverageRecord,
} from "../../application/eligibility-area-reader";
import { kstDate } from "../../domain/kst-day";
import type { AuctionReadDatabase } from "./drizzle-auction-reader";
import { readActiveMartBuildLineage } from "./drizzle-mart-build-reader";
import { eligibilityAreaCatalogQuery } from "./eligibility-area-sql";
import { OPEN_AUCTION_SNAPSHOT } from "./open-auction-queries";
import { coverageTodayQuery, coverageWindowQuery } from "./region-coverage-queries";
import { codeReferenceRecord, type EligibilityAreaJson } from "./postgres-row-values";

type CatalogRow = Readonly<{
  all_code_value_id: string;
  all_code: string;
  all_scheme: string;
  all_label: string | null;
  parts: readonly EligibilityAreaJson[];
}>;

type TodayRow = Readonly<{
  nationwide_count: number;
  matched_count: number;
  unobserved_count: number;
}>;

type WindowRow = Readonly<{
  days_with_auctions: number;
  median_day_count: number | null;
  peak_date: string | null;
  peak_count: number | null;
}>;

function rows<Row>(result: unknown): readonly Row[] {
  return Array.isArray(result) ? result as Row[] : [];
}

function reference(codeValueId: string, code: string, scheme: string, label: string | null) {
  const record = codeReferenceRecord(codeValueId, code, scheme, label);
  if (record === null) throw new TypeError("Database eligibility area row is incomplete");
  return record;
}

function toGroup(row: CatalogRow): EligibilityAreaGroupRecord {
  return {
    all: reference(row.all_code_value_id, row.all_code, row.all_scheme, row.all_label),
    parts: row.parts.map((part) => reference(part.code_value_id, part.code, part.scheme, part.label)),
  };
}

export class DrizzleEligibilityAreaReader implements EligibilityAreaReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async listAreas(): Promise<EligibilityAreaCatalog> {
    const groups = rows<CatalogRow>(await this.database.execute(eligibilityAreaCatalogQuery())).map(toGroup);
    const areas = groups.flatMap((group) => [group.all, ...group.parts]);
    return {
      // 체계 이름은 행이 스스로 말한다. 어댑터가 다시 적으면 선언이 둘이 된다(AGENTS 6).
      scheme: groups[0]?.all.scheme ?? "",
      groups,
      areaCount: areas.length,
      unlabeledAreaCount: areas.filter((area) => area.label === null).length,
    };
  }

  /**
   * 세 조회를 함께 보낸다. 오늘 숫자와 과거 창은 서로 다른 출처를 읽지만 같은 `asOf` 하나를 기준으로
   * 물어야 화면이 적은 두 숫자가 같은 순간의 사실이 된다.
   */
  async previewCoverage(query: RegionCoverageQuery): Promise<RegionCoverageRecord> {
    const [todayResult, windowResult, snapshotLineage] = await Promise.all([
      this.database.execute(coverageTodayQuery({ asOf: query.asOf, codeValueIds: query.codeValueIds })),
      this.database.execute(coverageWindowQuery(query)),
      readActiveMartBuildLineage(this.database, OPEN_AUCTION_SNAPSHOT),
    ]);
    const today = rows<TodayRow>(todayResult)[0];
    const window = rows<WindowRow>(windowResult)[0];
    return {
      today: {
        matchedCount: today?.matched_count ?? 0,
        unobservedCount: today?.unobserved_count ?? 0,
        nationwideCount: today?.nationwide_count ?? 0,
      },
      window: {
        daysWithAuctions: window?.days_with_auctions ?? 0,
        medianDayCount: window?.median_day_count ?? null,
        // 창 안에 공고가 없으면 최대치를 지어내지 않고 없는 상태로 둔다(AGENTS 3).
        peakDay: window?.peak_date == null || window.peak_count == null
          ? null
          : { date: kstDate(window.peak_date), count: window.peak_count },
      },
      snapshotLineage,
    };
  }
}
