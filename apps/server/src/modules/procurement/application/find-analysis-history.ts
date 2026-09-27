/**
 * @module 책임: 분석 전체 개찰 이력 한 페이지를 조건·집단·고정 build로 읽고, build가 바뀐 페이지 요청을 거절한다.
 *
 * 시간축과 나눈 이유는 답의 모양과 읽는 방식이 다르기 때문이다. 그림은 한 번에 끝나는 집계이고, 이력은
 * 사용자가 스크롤하며 여러 번 이어 읽는 행 목록이다. 이어 읽는 동안 기준이 바뀌지 않아야 한다.
 */
import { Effect } from "effect";
import type { BidRate } from "@eatbid/domain";
import { assertAnalysisAxesExist, type AnalysisRegionNotFound } from "./analysis-axes";
import type { AnalysisHistoryPageReading, AnalysisHistoryReader } from "./analysis-history-reader";
import type { AnalysisComparisonScope, AnalysisItemFilter, AnalysisTimeSeriesReader } from "./analysis-time-series-reader";
import { rateTextMilli } from "./distribution-statistics";
import { ProcurementDependencyUnavailable } from "./failures";
import type { AnalysisPeriodInput } from "./find-analysis-time-series";
import type { OrganizationNotFound } from "./list-organization-auction-attempts";
import type { MartBuildLineage } from "./mart-build-lineage";
import { kstDayAfter, kstDayStart } from "../domain/kst-day";
import type { OrganizationId } from "../domain/organization-id";

export interface FindAnalysisHistoryInput {
  readonly targetOrganizationId: OrganizationId;
  readonly excludeAttemptId: bigint | null;
  readonly period: AnalysisPeriodInput;
  readonly dateBasis: "opened" | "announced";
  readonly comparisonScope: AnalysisComparisonScope;
  readonly floorRate: BidRate;
  readonly awardMethodCodeValueId: bigint;
  readonly listCountMin: number | null;
  readonly listCountMax: number | null;
  readonly itemFilter: AnalysisItemFilter;
  readonly population: "target" | "comparison";
  readonly cursorAttemptId: bigint | null;
  readonly limit: number;
  /** 첫 응답의 build다. 다음 페이지 요청만 가진다. */
  readonly expectedBuildId: bigint | null;
}

export type AnalysisHistoryResult =
  | { readonly kind: "empty"; readonly input: FindAnalysisHistoryInput }
  | {
      readonly kind: "page";
      readonly input: FindAnalysisHistoryInput;
      readonly lineage: MartBuildLineage;
      readonly page: Extract<AnalysisHistoryPageReading, { kind: "page" }>;
    };

/** 첫 페이지의 build가 더 이상 활성이 아니다. 화면은 첫 페이지부터 다시 읽는다. */
export class AnalysisHistoryBuildChanged extends Error {
  readonly code = "CONFLICT" as const;

  constructor(readonly expectedBuildId: bigint, readonly activeBuildId: bigint | null) {
    super(`Expected build ${expectedBuildId.toString(10)} is no longer active`);
    this.name = "AnalysisHistoryBuildChanged";
  }
}

/** 커서의 회차가 이 조건·집단·build의 줄이 아니다. 다른 목록의 커서를 붙인 요청이다. */
export class AnalysisHistoryCursorInvalid extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(readonly cursorAttemptId: bigint) {
    super(`Cursor attempt ${cursorAttemptId.toString(10)} is not in this history`);
    this.name = "AnalysisHistoryCursorInvalid";
  }
}

type HistoryFailure =
  | ProcurementDependencyUnavailable
  | OrganizationNotFound
  | AnalysisRegionNotFound
  | AnalysisHistoryBuildChanged
  | AnalysisHistoryCursorInvalid;

export class FindAnalysisHistory {
  constructor(
    private readonly reader: AnalysisHistoryReader,
    private readonly axes: AnalysisTimeSeriesReader,
  ) {}

  execute(input: FindAnalysisHistoryInput): Effect.Effect<AnalysisHistoryResult, HistoryFailure, never> {
    return assertAnalysisAxesExist(this.axes, input.targetOrganizationId, input.comparisonScope).pipe(
      Effect.flatMap(() => this.dependency(() => this.reader.activeLineage())),
      Effect.flatMap((lineage): Effect.Effect<AnalysisHistoryResult, HistoryFailure, never> => {
        if (lineage === null) {
          // 활성 build가 없는데 다음 페이지를 달라면 그 build는 사라진 것이다. 빈 목록으로 답하면 사용자가
          // 이미 받은 줄이 마지막인 줄 안다.
          return input.expectedBuildId === null
            ? Effect.succeed({ kind: "empty", input })
            : Effect.fail(new AnalysisHistoryBuildChanged(input.expectedBuildId, null));
        }
        if (input.expectedBuildId !== null && input.expectedBuildId !== lineage.buildId) {
          return Effect.fail(new AnalysisHistoryBuildChanged(input.expectedBuildId, lineage.buildId));
        }
        return this.dependency(() => this.reader.readPage({
          targetOrganizationId: input.targetOrganizationId,
          excludeAttemptId: input.excludeAttemptId,
          from: kstDayStart(input.period.from),
          before: kstDayAfter(input.period.to),
          dateBasis: input.dateBasis,
          floorRateMilli: rateTextMilli(input.floorRate),
          awardMethodCodeValueId: input.awardMethodCodeValueId,
          listCountMin: input.listCountMin,
          listCountMax: input.listCountMax,
          itemFilter: input.itemFilter,
          // 겹쳐 찍을 기관은 표시 축이라 이력의 집합을 바꾸지 않는다(PDR-0007).
          overlayOrganizationIds: [],
          comparisonScope: input.comparisonScope,
          population: input.population,
          buildId: lineage.buildId,
          cursorAttemptId: input.cursorAttemptId,
          limit: input.limit,
        })).pipe(Effect.flatMap((page): Effect.Effect<AnalysisHistoryResult, HistoryFailure, never> =>
          page.kind === "cursor-not-found"
            ? Effect.fail(new AnalysisHistoryCursorInvalid(input.cursorAttemptId ?? 0n))
            : Effect.succeed({ kind: "page", input, lineage, page })));
      }),
    );
  }

  private dependency<Value>(read: () => Promise<Value>): Effect.Effect<Value, ProcurementDependencyUnavailable, never> {
    return Effect.tryPromise({ try: read, catch: (cause) => new ProcurementDependencyUnavailable(cause) });
  }
}
