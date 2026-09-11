/**
 * @module 책임: 참가제한지역 목록 조회와 저장 전 선택 미리보기 use case의 실패 분류와 관측 창 확정을
 * 소유한다.
 */
import { REGION_COVERAGE_WINDOW_DAYS } from "@eatbid/contracts";
import { Temporal, type Clock } from "@eatbid/domain";
import { Effect } from "effect";

import { ProcurementDependencyUnavailable } from "./failures";
import type {
  EligibilityAreaCatalog,
  EligibilityAreaReader,
  RegionCoverageQuery,
  RegionCoverageRecord,
} from "./eligibility-area-reader";

export class ListEligibilityAreas {
  constructor(private readonly reader: EligibilityAreaReader) {}

  execute(): Effect.Effect<EligibilityAreaCatalog, ProcurementDependencyUnavailable, never> {
    return Effect.tryPromise({
      try: () => this.reader.listAreas(),
      catch: (cause) => new ProcurementDependencyUnavailable(cause),
    });
  }
}

export interface RegionCoverageResult {
  readonly query: RegionCoverageQuery;
  readonly coverage: RegionCoverageRecord;
}

export class PreviewRegionCoverage {
  constructor(private readonly reader: EligibilityAreaReader, private readonly clock: Clock) {}

  /**
   * 창의 양끝을 use case가 확정해 응답이 그대로 싣는다. 어댑터가 SQL에서 `now()`를 부르면 세 숫자가 서로
   * 다른 순간을 보고, 화면이 "지난 90일"이라고 적은 구간이 응답으로 재현되지 않는다(AGENTS 7·17).
   */
  execute(input: { readonly codeValueIds: readonly bigint[] }): Effect.Effect<
    RegionCoverageResult,
    ProcurementDependencyUnavailable,
    never
  > {
    const asOf = this.clock.now();
    const query: RegionCoverageQuery = {
      asOf,
      windowStart: asOf.subtract(Temporal.Duration.from({ hours: REGION_COVERAGE_WINDOW_DAYS * 24 })),
      codeValueIds: input.codeValueIds,
    };
    return Effect.tryPromise({
      try: () => this.reader.previewCoverage(query),
      catch: (cause) => new ProcurementDependencyUnavailable(cause),
    }).pipe(Effect.map((coverage) => ({ query, coverage })));
  }
}
