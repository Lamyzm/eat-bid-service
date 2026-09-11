/**
 * @module 책임: 참가제한지역 선택 목록과 선택 하나의 공고 적용 결과를 읽는 port와 그 application record
 * 형태를 소유한다.
 */
import type { Temporal } from "@eatbid/domain";

import type { CodeReferenceRecord } from "./auction-reader";
import type { MartBuildLineage } from "./mart-build-lineage";
import type { KstDate } from "../domain/kst-day";

/**
 * 한 시도의 묶음이다. `all`은 그 시도 전체로 열린 공고를 가리키는 코드이고 `parts`는 같은 시도 아래
 * 관측된 시군구 코드들이다. 둘을 한 배열로 합치지 않는 이유는 선택 시점에 하는 일이 다르기 때문이다 —
 * `parts` 하나를 고르면 `all`이 함께 켜지지만 반대는 성립하지 않는다(ADR 0048 결정 2).
 */
export interface EligibilityAreaGroupRecord {
  readonly all: CodeReferenceRecord;
  readonly parts: readonly CodeReferenceRecord[];
}

export interface EligibilityAreaCatalog {
  readonly scheme: string;
  readonly groups: readonly EligibilityAreaGroupRecord[];
  readonly areaCount: number;
  readonly unlabeledAreaCount: number;
}

export interface RegionCoverageQuery {
  /** "열림" 판정과 과거 창의 끝을 함께 정하는 기준 시각이다. */
  readonly asOf: Temporal.Instant;
  readonly windowStart: Temporal.Instant;
  /** 아직 저장하지 않은 선택이다. 빈 배열은 "고른 지역이 없다"이며 유효한 질문이다. */
  readonly codeValueIds: readonly bigint[];
}

export interface RegionCoverageTodayRecord {
  readonly matchedCount: number;
  readonly unobservedCount: number;
  readonly nationwideCount: number;
}

export interface RegionCoveragePeakDayRecord {
  readonly date: KstDate;
  readonly count: number;
}

/**
 * 과거 창 관측이다. 일 평균을 내지 않는다 — 0건인 날이 3분의 2인 분포에서 평균은 성수기도 한가한 날도
 * 말하지 못한다. 창 안에 공고가 하나도 없으면 `daysWithAuctions`가 0이고 나머지는 null이다.
 */
export interface RegionCoverageWindowRecord {
  readonly daysWithAuctions: number;
  readonly medianDayCount: number | null;
  readonly peakDay: RegionCoveragePeakDayRecord | null;
}

export interface RegionCoverageRecord {
  readonly today: RegionCoverageTodayRecord;
  readonly window: RegionCoverageWindowRecord;
  readonly snapshotLineage: MartBuildLineage | null;
}

export interface EligibilityAreaReader {
  listAreas(): Promise<EligibilityAreaCatalog>;
  previewCoverage(query: RegionCoverageQuery): Promise<RegionCoverageRecord>;
}
