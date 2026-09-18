/**
 * @module 책임: 분석 조건 막대가 고를 수 있는 지역·기관·품목과 건수를 한 번의 읽기로 조립한다.
 *
 * 시간축과 나눈 이유는 답이 바뀌는 시점이 다르기 때문이다. 조건 사전은 시도를 펼치거나 기관 이름을
 * 적을 때마다 다시 필요하고, 그림은 조건이 확정될 때만 다시 필요하다. 한 조회로 묶으면 목록을 펼칠
 * 때마다 23만 회차를 다시 접게 된다.
 */
import { Effect } from "effect";
import type { BidRate } from "@eatbid/domain";
import { ProcurementDependencyUnavailable } from "./failures";
import { OrganizationNotFound } from "./list-organization-auction-attempts";
import type {
  AnalysisConditionOptionsReader,
  AnalysisConditionOptionsReading,
} from "./analysis-condition-options-reader";
import type {
  AnalysisComparisonScope,
  AnalysisItemFilter,
  AnalysisTimeSeriesReader,
} from "./analysis-time-series-reader";
import { rateTextMilli } from "./distribution-statistics";
import { AnalysisRegionNotFound, type AnalysisPeriodInput } from "./find-analysis-time-series";
import { kstDayAfter, kstDayStart } from "../domain/kst-day";
import type { OrganizationId } from "../domain/organization-id";

/** 조건 사전 요청이다. 코호트 조건은 시간축과 같고 화면이 지금 펼친 자리만 두 값으로 더 말한다. */
export interface FindAnalysisConditionOptionsInput {
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
  /** 이 시도의 시군구를 함께 달라는 요청이다. null이면 시군구를 세지 않는다. */
  readonly sido: bigint | null;
  readonly organizationQuery: string | null;
}

export interface AnalysisConditionOptionsResult {
  readonly input: FindAnalysisConditionOptionsInput;
  readonly reading: AnalysisConditionOptionsReading;
}

/**
 * 기관 목록 상한이다. 화면이 여섯을 고르게 하므로 목록은 고를 것을 찾을 만큼만 있으면 되고, 넘으면
 * 잘렸다고 말해 검색어를 더 적게 한다. 무한 목록을 내려보내면 전국 기관 수만 명이 브라우저로 간다.
 */
const ORGANIZATION_LIMIT = 50;

export class FindAnalysisConditionOptions {
  /**
   * 시각을 받지 않는다. 이 답의 출처는 건수를 만든 mart build이고 그 계보가 `computedAt`을 이미 갖는다 —
   * 물은 시각을 함께 실으면 "언제까지의 자료인가"와 "언제 물었는가"가 한 자리에서 섞인다(AGENTS 7).
   */
  constructor(
    private readonly reader: AnalysisConditionOptionsReader,
    private readonly axes: AnalysisTimeSeriesReader,
  ) {}

  execute(input: FindAnalysisConditionOptionsInput): Effect.Effect<
    AnalysisConditionOptionsResult,
    ProcurementDependencyUnavailable | OrganizationNotFound | AnalysisRegionNotFound,
    never
  > {
    // 존재 확인을 먼저 끝내야 "그 축이 없음"과 "조건에 맞는 회차가 없음"이 같은 빈 목록으로 뭉개지지 않는다.
    return this.assertAxesExist(input).pipe(
      Effect.flatMap(() => Effect.tryPromise({
        try: () => this.reader.readConditionOptions({
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
          // 겹쳐 찍을 기관은 표시 축이라 사전의 건수를 바꾸지 않는다. 여기서 빈 목록을 주는 것이
          // "이 조회는 그 축을 보지 않는다"는 뜻이다(PDR-0007).
          overlayOrganizationIds: [],
          comparisonScope: input.comparisonScope,
          sido: input.sido,
          organizationQuery: input.organizationQuery,
          organizationLimit: ORGANIZATION_LIMIT,
        }),
        catch: (cause) => new ProcurementDependencyUnavailable(cause),
      })),
      Effect.map((reading) => ({ input, reading })),
    );
  }

  private assertAxesExist(input: FindAnalysisConditionOptionsInput): Effect.Effect<
    void,
    ProcurementDependencyUnavailable | OrganizationNotFound | AnalysisRegionNotFound,
    never
  > {
    const scope = input.comparisonScope;
    const organization = this.exists(
      () => this.axes.organizationExists(input.targetOrganizationId),
      () => new OrganizationNotFound(input.targetOrganizationId),
    );
    if (scope.kind === "national") return organization;
    return organization.pipe(Effect.flatMap(() => this.exists(
      () => this.axes.regionExists(scope.scheme, scope.codeValueId),
      () => new AnalysisRegionNotFound(scope.scheme, scope.codeValueId),
    )));
  }

  private exists<Failure>(
    read: () => Promise<boolean>,
    missing: () => Failure,
  ): Effect.Effect<void, ProcurementDependencyUnavailable | Failure, never> {
    return Effect.tryPromise({
      try: read,
      catch: (cause): ProcurementDependencyUnavailable => new ProcurementDependencyUnavailable(cause),
    }).pipe(Effect.flatMap((found) => found ? Effect.succeed(undefined) : Effect.fail(missing())));
  }
}
