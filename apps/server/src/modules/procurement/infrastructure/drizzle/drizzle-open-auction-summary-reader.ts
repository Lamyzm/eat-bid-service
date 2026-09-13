/** @module 책임: 열린 공고 요약 port를 한 번의 조회와 그 행 하나의 매핑으로 구현한다. */
import type {
  OpenAuctionCalendarDayRecord,
  OpenAuctionDayMarkRecord,
  OpenAuctionFloorShareRecord,
  OpenAuctionSummaryQuery,
  OpenAuctionSummaryReader,
  OpenAuctionSummaryRecord,
} from "../../application/open-auction-summary-reader";
import { postgresInstant, type AuctionReadDatabase } from "./drizzle-auction-reader";
import { readActiveMartBuildLineage } from "./drizzle-mart-build-reader";
import { bidRateValue } from "./postgres-row-values";
import { OPEN_AUCTION_SNAPSHOT } from "./open-auction-queries";
import { openAuctionSummaryQuerySql } from "./open-auction-summary-query";

type PostgresTimestamp = Parameters<typeof postgresInstant>[0];

/**
 * 집계 셋을 jsonb로 받는 이유는 한 왕복 안에서 모양이 다른 결과를 함께 돌려받기 위해서다. 날짜별
 * 칸·하한 구성은 행이 여럿이고 나머지는 수 하나라, 나누면 조회가 넷이 되고 그 넷이 서로 다른 시각을
 * 볼 수 있다.
 */
type SummaryRow = Readonly<{
  total_count: number;
  organization_count: number;
  opened_today_count: number;
  closing_today_count: number;
  latest_observed_at: PostgresTimestamp | null;
  calendar: readonly { date: string; count: number; releasedCount: number }[] | null;
  floors: readonly { rate: string | null; count: number }[] | null;
  next_closing_day: { date: string; count: number } | null;
}>;

export class DrizzleOpenAuctionSummaryReader implements OpenAuctionSummaryReader {
  constructor(private readonly database: AuctionReadDatabase) {}

  async summarizeOpen(query: OpenAuctionSummaryQuery): Promise<OpenAuctionSummaryRecord> {
    const [rows, snapshotLineage] = await Promise.all([
      this.database.execute(openAuctionSummaryQuerySql(query)),
      readActiveMartBuildLineage(this.database, OPEN_AUCTION_SNAPSHOT),
    ]);
    const row = (Array.isArray(rows) ? rows[0] as SummaryRow | undefined : undefined);
    if (row === undefined) {
      // 집계 조회는 행이 없을 수 없다. 없으면 조회가 바뀐 것이므로 0으로 위장하지 않고 드러낸다.
      throw new Error("Open auction summary query returned no row");
    }
    return {
      totalCount: row.total_count,
      organizationCount: row.organization_count,
      openedTodayCount: row.opened_today_count,
      closingTodayCount: row.closing_today_count,
      floorShares: floorShares(row.floors),
      calendar: calendarDays(row.calendar),
      latestObservedAt: row.latest_observed_at === null ? null : postgresInstant(row.latest_observed_at),
      nextClosingDay: dayMark(row.next_closing_day),
      snapshotLineage,
    };
  }
}

// jsonb_agg는 행이 하나도 없으면 null이다. 빈 배열과 같은 뜻이라 여기서 한 번만 편다.
function calendarDays(value: SummaryRow["calendar"]): readonly OpenAuctionCalendarDayRecord[] {
  return value === null ? [] : value.map((day) => ({
    date: day.date,
    count: day.count,
    releasedCount: day.releasedCount,
  }));
}

function floorShares(value: SummaryRow["floors"]): readonly OpenAuctionFloorShareRecord[] {
  return value === null ? [] : value.map((share) => ({ rate: bidRateValue(share.rate), count: share.count }));
}

function dayMark(value: SummaryRow["next_closing_day"]): OpenAuctionDayMarkRecord | null {
  return value === null ? null : { date: value.date, count: value.count };
}
