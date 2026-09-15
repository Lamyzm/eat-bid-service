/** @module 책임: 열린 공고 요약 결과(reader query와 집계)를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import type { OpenAuctionSummaryV1Response } from "@eatbid/contracts";

import { bidRateWire, instantText, martBuildLineageWire } from "../../../../platform/http/wire";
import type { OpenAuctionSummaryResult } from "../../application/summarize-open-auctions";

export function toOpenAuctionSummaryResponse(result: OpenAuctionSummaryResult): OpenAuctionSummaryV1Response {
  const { query, summary } = result;
  return {
    totalCount: summary.totalCount,
    organizationCount: summary.organizationCount,
    // `진행중` 탭의 수는 싣지 않는다. 날짜 축을 받지 않는 요약이라 `totalCount`가 그 값이고, 같은 수를
    // 두 자리에 두면 언젠가 한쪽만 고쳐져 탭과 축 줄이 다른 말을 한다.
    tabs: {
      // 한 건도 게시일을 관측하지 못했으면 0이 아니라 null이다. 0은 "세었는데 오늘 뜬 것이 없다"이고
      // null은 "셀 수 없다"이며, 사용자가 할 일이 서로 다르다(AGENTS 3).
      openedToday: summary.announcedUnobservedCount === summary.totalCount && summary.totalCount > 0
        ? null
        : summary.openedTodayCount,
      closingToday: summary.closingTodayCount,
    },
    announcedUnobservedCount: summary.announcedUnobservedCount,
    floorShares: summary.floorShares.map((share) => ({
      rate: share.rate === null ? null : bidRateWire(share.rate),
      count: share.count,
    })),
    calendar: summary.calendar.map((day) => ({
      date: day.date,
      count: day.count,
      releasedCount: day.releasedCount,
    })),
    latestObservedAt: summary.latestObservedAt === null ? null : instantText(summary.latestObservedAt),
    nextClosingDay: summary.nextClosingDay,
    meta: {
      // 기준 시각과 달력 창을 되돌려 실어야 이 수치들이 어느 코호트의 것인지 응답만으로 닫힌다.
      asOf: instantText(query.asOf),
      calendarFrom: query.calendarFrom,
      calendarTo: query.calendarTo,
      openAuctionSnapshotBuild: martBuildLineageWire(summary.snapshotLineage),
    },
  };
}
