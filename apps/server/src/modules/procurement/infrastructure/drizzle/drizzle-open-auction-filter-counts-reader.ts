/** @module 책임: 필터 한 벌 여럿의 건수 port를 한 번의 조회와 그 행 하나의 매핑으로 구현한다. */
import type {
  OpenAuctionFilterCountsQuery,
  OpenAuctionFilterCountsReader,
  OpenAuctionFilterCountsRecord,
} from "../../application/count-open-auctions-for-filters";
import type { AuctionReadDatabase } from "./drizzle-auction-reader";
import { readActiveMartBuildLineage } from "./drizzle-mart-build-reader";
import { openAuctionFilterCountsQuerySql } from "./filter-combination-counts-query";
import { OPEN_AUCTION_SNAPSHOT } from "./open-auction-queries";

type CountsRow = Readonly<Record<string, number>>;

export class DrizzleOpenAuctionFilterCountsReader implements OpenAuctionFilterCountsReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async countForFilters(query: OpenAuctionFilterCountsQuery): Promise<OpenAuctionFilterCountsRecord> {
    const [result, snapshotLineage] = await Promise.all([
      this.database.execute(openAuctionFilterCountsQuerySql(query)),
      readActiveMartBuildLineage(this.database, OPEN_AUCTION_SNAPSHOT),
    ]);
    const row = Array.isArray(result) ? result[0] as CountsRow | undefined : undefined;
    // 집계 조회는 행이 없을 수 없다. 없으면 조회가 바뀐 것이므로 0으로 위장하지 않고 드러낸다.
    if (row === undefined) throw new Error("Open auction filter counts query returned no row");
    return {
      regionAll: row.region_all ?? 0,
      regionClosingToday: row.region_closing_today ?? 0,
      noBids: row.no_bids ?? 0,
      itemUnknownIncluded: row.item_unknown_included ?? 0,
      // 요청한 순서 그대로 다시 짝짓는다. 열 이름이 위치라 이 순서가 유일한 연결이다.
      saved: query.saved.map((_filter, index) => row[`saved_${index}`] ?? 0),
      snapshotLineage,
    };
  }
}
