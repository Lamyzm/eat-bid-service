/**
 * @module 책임: 하한선 자리(PDR-0009)의 공고별 하한선·선택한 1~10등 사다리·같은 판의 하한선 분포와 지역 목록 조회를 조립한다.
 *
 * 분포는 맞춤 금액·복기가 쓰는 예정가격 추첨 분포 판을 그대로 뒤집는다. 하한선 위치를 예측하지 않는다 — 분포는 제도가
 * 정한 모양이고, 화면은 실제 점과 그 모양을 나란히 보인다.
 */
import { Effect } from "effect";
import { CODE_SCHEME_NAMES } from "@eatbid/contracts";
import type { BaseRelativeBidRate, BidRate } from "@eatbid/domain";

import { AnalysisRegionNotFound, type AnalysisAxisLookup } from "./analysis-axes";
import { rateTextMilli } from "./distribution-statistics";
import { ProcurementDependencyUnavailable } from "./failures";
import type {
  FloorLineLadderRecord,
  FloorLinePointRecord,
  FloorLineReader,
  FloorLineRegionRecord,
  FloorLineWindow,
} from "./floor-line-reader";
import type { MartBuildLineage } from "./mart-build-lineage";
import { floorLineQuantiles } from "../domain/floor-line-quantiles";
import { kstDayAfter, kstDayStart, type KstDate } from "../domain/kst-day";
import type { PlannedRatioDistribution } from "../domain/market-position-pick";
import { PLANNED_RATIO_DISTRIBUTION } from "../domain/planned-ratio-distribution-table";

export interface FloorLinePeriodInput {
  readonly from: KstDate;
  readonly to: KstDate;
}

export interface FindFloorLinesInput {
  readonly sigunguCodeValueId: bigint;
  readonly period: FloorLinePeriodInput;
  readonly floorRate: BidRate;
  readonly includeLadders: boolean;
}

export interface FloorLineRule {
  readonly version: string;
  readonly sourceRounds: number;
  readonly quantiles: readonly BaseRelativeBidRate[];
}

export interface FloorLinesResult {
  readonly lineage: MartBuildLineage | null;
  readonly regionCodeValueId: bigint;
  readonly regionLabel: string | null;
  readonly period: FloorLinePeriodInput;
  readonly floorRate: BidRate;
  readonly points: readonly FloorLinePointRecord[];
  /** 요청하지 않았으면 null이다. 빈 배열은 "명단이 관측된 회차가 없다"는 다른 뜻이다. */
  readonly ladders: readonly FloorLineLadderRecord[] | null;
  readonly rule: FloorLineRule;
}

export interface FindFloorLineRegionsInput {
  readonly period: FloorLinePeriodInput;
  readonly floorRate: BidRate;
}

export interface FloorLineRegionsResult {
  readonly lineage: MartBuildLineage | null;
  readonly period: FloorLinePeriodInput;
  readonly floorRate: BidRate;
  readonly regions: readonly FloorLineRegionRecord[];
}

function windowOf(period: FloorLinePeriodInput, floorRate: BidRate): FloorLineWindow {
  return { from: kstDayStart(period.from), before: kstDayAfter(period.to), floorRateMilli: rateTextMilli(floorRate) };
}

function read<Value>(task: () => Promise<Value>): Effect.Effect<Value, ProcurementDependencyUnavailable, never> {
  return Effect.tryPromise({ try: task, catch: (cause) => new ProcurementDependencyUnavailable(cause) });
}

export class FindFloorLines {
  constructor(
    private readonly reader: FloorLineReader,
    private readonly axes: AnalysisAxisLookup,
    private readonly distribution: PlannedRatioDistribution = PLANNED_RATIO_DISTRIBUTION,
  ) {}

  execute(input: FindFloorLinesInput): Effect.Effect<FloorLinesResult, ProcurementDependencyUnavailable | AnalysisRegionNotFound, never> {
    const scheme = CODE_SCHEME_NAMES.auctionLocationSigungu;
    const window = windowOf(input.period, input.floorRate);
    const rule: FloorLineRule = {
      version: this.distribution.version,
      sourceRounds: this.distribution.sourceRounds,
      quantiles: floorLineQuantiles(this.distribution, input.floorRate),
    };
    return read(() => this.axes.regionExists(scheme, input.sigunguCodeValueId)).pipe(
      Effect.flatMap((found) => found
        ? Effect.succeed(undefined)
        : Effect.fail(new AnalysisRegionNotFound(scheme, input.sigunguCodeValueId))),
      Effect.flatMap(() => read(() => Promise.all([
        this.reader.activeLineage(),
        this.reader.regionLabel(input.sigunguCodeValueId),
        this.reader.readPoints(window, input.sigunguCodeValueId),
        input.includeLadders ? this.reader.readLadders(window, input.sigunguCodeValueId) : Promise.resolve(null),
      ]))),
      Effect.map(([lineage, regionLabel, points, ladders]) => ({
        lineage,
        regionCodeValueId: input.sigunguCodeValueId,
        regionLabel,
        period: input.period,
        floorRate: input.floorRate,
        points,
        ladders,
        rule,
      })),
    );
  }
}

export class FindFloorLineRegions {
  constructor(private readonly reader: FloorLineReader) {}

  execute(input: FindFloorLineRegionsInput): Effect.Effect<FloorLineRegionsResult, ProcurementDependencyUnavailable, never> {
    const window = windowOf(input.period, input.floorRate);
    return read(() => Promise.all([this.reader.activeLineage(), this.reader.readRegions(window)])).pipe(
      Effect.map(([lineage, regions]) => ({ lineage, period: input.period, floorRate: input.floorRate, regions })),
    );
  }
}
