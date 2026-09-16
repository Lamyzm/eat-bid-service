/**
 * @module 책임: 열린 공고 요약 조회의 application port와 화면이 세는 자리를 담은 내부 record를 소유한다.
 *
 * 목록 port와 나누는 이유는 세는 범위가 다르기 때문이다. 목록은 페이지를 돌려주고 요약은 필터를
 * 만족하는 전체를 센다. 필터 atom은 같은 것을 쓰며 갈리면 축 줄의 건수와 목록의 행이 서로 다른
 * 코호트를 말하게 된다.
 */
import type { AuctionItemAtom } from "@eatbid/contracts";
import type { BidRate, Temporal } from "@eatbid/domain";

import type { MartBuildLineage } from "./mart-build-lineage";

export interface OpenAuctionSummaryQuery {
  /** "열림"의 기준 시각이다. use case가 주입된 clock에서 한 번 읽어 넘긴다(AGENTS 15·17). */
  readonly asOf: Temporal.Instant;
  readonly sidoCodeValueId: bigint | null;
  readonly sigunguCodeValueIds: readonly bigint[] | null;
  readonly eligibilityAreaCodeValueIds: readonly bigint[] | null;
  /** 품목 조각들이다. 한 조각이라도 라벨 안에 들어 있으면 걸린다(부분일치 OR). */
  readonly itemLabels: readonly string[] | null;
  /** 품목 축이 걸렸을 때 라벨 미관측 행을 함께 셀지다. 목록과 같은 술어를 써야 두 수가 같은 집합을 말한다. */
  readonly includeUnknownItem: boolean;
  readonly baseAmountMin: string | null;
  readonly baseAmountMax: string | null;
  /** 달력 창의 양끝이다. KST 달력일이며 창 밖 마감은 전체 수에는 들어가도 달력에는 없다. */
  readonly calendarFrom: string;
  readonly calendarTo: string;
}

/**
 * 달력 칸 하나다. `count`는 지금 걸린 조건의 수이고 `releasedCount`는 지역 축만 남기고 품목·금액을
 * 푼 수다. 둘이 같은 스캔에서 나와야 화면의 `2건 · 7건 중`이 같은 시각을 본다.
 */
export interface OpenAuctionCalendarDayRecord {
  readonly date: string;
  readonly count: number;
  readonly releasedCount: number;
}

/** 결과 집합의 하한율 구성이다. 관측되지 않은 행은 `rate`가 null인 항목으로 함께 센다. */
export interface OpenAuctionFloorShareRecord {
  readonly rate: BidRate | null;
  readonly count: number;
}

/**
 * 지역 축을 푼 집합에서 센 공고지역 하나다. 라벨은 최신 관측이며 없으면 null이다 — 코드목록 수집
 * (EAT-187)이 돌기 전의 DB가 그렇고, 그때도 항목은 남아야 한다(AGENTS 3).
 */
export interface OpenAuctionRegionCountRecord {
  readonly codeValueId: bigint;
  readonly code: string;
  readonly scheme: string;
  readonly label: string | null;
  readonly count: number;
}

/** 품목 축을 푼 집합에서 원자 하나가 라벨에 들어 있는 행 수다. 여덟 원자 전부가 0을 포함해 온다. */
export interface OpenAuctionItemCountRecord {
  readonly item: AuctionItemAtom;
  readonly count: number;
}

export interface OpenAuctionDayMarkRecord {
  readonly date: string;
  readonly count: number;
}

export interface OpenAuctionSummaryRecord {
  readonly totalCount: number;
  readonly organizationCount: number;
  /** `진행중` 탭의 수는 여기 없다. 날짜 축을 받지 않는 요약이라 `totalCount`가 그 값이다. */
  readonly openedTodayCount: number;
  /**
   * 게시일을 관측하지 못한 행 수다. 게시일은 목록이 주지 않고 상세 revision에서만 오므로 한 건도
   * 관측하지 못한 build가 있다. 이 수가 `totalCount`와 같으면 `오늘 열린`을 아예 셀 수 없다.
   */
  readonly announcedUnobservedCount: number;
  readonly closingTodayCount: number;
  readonly floorShares: readonly OpenAuctionFloorShareRecord[];
  /**
   * 조건 기둥의 배지 넷이다. 각각 **그 축 하나만 푼 집합**에서 센다 — 시도·시군구·지역 미상은 품목·금액·
   * 제한지역을 유지한 채 지역을 풀고, 품목·품목 미상은 지역·금액·제한지역을 유지한 채 품목을 푼다.
   * `sigunguCounts`는 `sidoCodeValueId`가 있을 때만 그 시도 안의 시군구다.
   */
  readonly sidoCounts: readonly OpenAuctionRegionCountRecord[];
  readonly sigunguCounts: readonly OpenAuctionRegionCountRecord[];
  readonly regionUnobservedCount: number;
  readonly itemCounts: readonly OpenAuctionItemCountRecord[];
  readonly itemUnobservedCount: number;
  readonly calendar: readonly OpenAuctionCalendarDayRecord[];
  /** 결과가 0건이면 null이다. 관측이 없으므로 "지금"이라고 말할 수 없다. */
  readonly latestObservedAt: Temporal.Instant | null;
  readonly nextClosingDay: OpenAuctionDayMarkRecord | null;
  readonly snapshotLineage: MartBuildLineage | null;
}

export interface OpenAuctionSummaryReader {
  summarizeOpen(query: OpenAuctionSummaryQuery): Promise<OpenAuctionSummaryRecord>;
}
