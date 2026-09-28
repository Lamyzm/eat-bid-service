/** @module 책임: 분석 전체 개찰 이력의 한 페이지를 고정한 build에서 읽는 port와 application record를 소유한다. */
import type { AuctionItemAtom } from "@eatbid/contracts";
import type { Money, ObservedBidRate, Temporal } from "@eatbid/domain";
import type { AnalysisCohortQuery } from "./analysis-time-series-reader";
import type { MartBuildLineage } from "./mart-build-lineage";

/**
 * 이력 한 페이지 요청이다. 코호트 조건은 시간축과 **같은 것**이고 집단·build·위치만 더한다.
 *
 * `buildId`는 use case가 정한 값이다. 어댑터가 활성 build를 스스로 다시 읽으면 페이지 사이에 build가 바뀌어
 * 같은 회차가 두 번 나오거나 빠진다.
 */
export interface AnalysisHistoryQuery extends AnalysisCohortQuery {
  readonly population: "target" | "comparison";
  readonly buildId: bigint;
  /** 앞 페이지 마지막 줄의 회차다. 그 회차의 날짜를 같은 build·같은 조건에서 읽어 다음 위치를 정한다. */
  readonly cursorAttemptId: bigint | null;
  readonly limit: number;
}

export interface AnalysisHistoryRowRecord {
  readonly attemptId: bigint;
  readonly revisionId: bigint;
  readonly organizationId: bigint;
  readonly organizationName: string | null;
  readonly announcedAt: Temporal.Instant;
  readonly openedAt: Temporal.Instant | null;
  /** 품목 원자다. 다리 행이 없으면 null — 공고가 품목을 말하지 않은 것이다. */
  readonly items: readonly AuctionItemAtom[] | null;
  readonly assessmentRate: ObservedBidRate;
  readonly secondRate: ObservedBidRate | null;
  readonly listCount: number | null;
  readonly belowDayFloorCount: number | null;
  readonly winner: { readonly supplierPartyId: bigint; readonly name: string | null } | null;
  readonly baseAmount: Money;
}

export type AnalysisHistoryPageReading =
  | {
      readonly kind: "page";
      readonly rows: readonly AnalysisHistoryRowRecord[];
      /** 이 페이지 뒤에 줄이 더 있다. 한 줄 더 읽어 안다 — 전체 수와 비교하면 필터 경계에서 어긋난다. */
      readonly hasMore: boolean;
      readonly totalCount: number;
    }
  /** 커서의 회차가 이 build·조건·집단에 없다. 다른 목록의 커서를 붙인 요청이다. */
  | { readonly kind: "cursor-not-found" };

export interface AnalysisHistoryReader {
  /** 지금 활성인 회차 요약 build의 계보다. 없으면 파생물이 아직 없는 것이다. */
  activeLineage(): Promise<MartBuildLineage | null>;
  readPage(query: AnalysisHistoryQuery): Promise<AnalysisHistoryPageReading>;
}
