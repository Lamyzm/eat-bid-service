/** @module 책임: 낙찰률 분포 조회의 기본 기간·실패 분류와 mart record→공개 V1 응답 직렬화를 소유한다. */
import {
  instantCodec,
  type DistributionBin,
  type MartCoverage,
  type WinRateDistributionMeta,
  type WinRateDistributionV1Response,
} from "@eatbid/contracts";
import type { BidRate, Clock } from "@eatbid/domain";
import { Effect } from "effect";
import { z } from "zod";
import {
  rateMilliText,
  ratioMillionthsText,
  summarizeDistribution,
  type DistributionBinBoundary,
  type DistributionBinCount,
  type DistributionSummary,
} from "./distribution-statistics";
import { AuctionDependencyUnavailable } from "./find-auction";
import { OrganizationNotFound } from "./list-organization-auction-attempts";
import type { MartBuildLineage } from "./mart-build-lineage";
import type {
  DistributionReading,
  WinRateDistributionReader,
} from "./win-rate-distribution-reader";
import {
  cohortOrganizationId,
  cohortRegionCodeValueId,
  type DistributionCohort,
} from "../domain/distribution-cohort";
import {
  kstMonthOf,
  kstMonthsBetween,
  shiftKstMonth,
  type KstMonth,
} from "../domain/kst-month";

// 화면 기간 칩의 최장이 12개월이라 기본 창도 12개월이다. 상한은 계약이 이미 막는다.
const DEFAULT_PERIOD_MONTHS = 12;

export interface FindWinRateDistributionInput {
  readonly cohort: DistributionCohort;
  readonly floorRate: BidRate;
  readonly awardMethodCodeValueId: bigint;
  readonly binWidth: BidRate;
  readonly granularity: "total" | "month";
  // null은 "기간을 지정하지 않았다"이며 그때 기본 창은 계약이 아니라 이 use case가 정한다.
  readonly period: { readonly from: KstMonth; readonly to: KstMonth } | null;
}

/** 지역 코드값이 없는 모집단은 표본이 없는 모집단과 다르다. 빈 분포로 뭉개면 두 사실이 하나가 된다. */
export class DistributionRegionNotFound extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor(readonly regionCodeValueId: bigint) {
    super(`Region code value ${regionCodeValueId.toString(10)} was not found`);
    this.name = "DistributionRegionNotFound";
  }
}

/**
 * 요청 칸 폭이 활성 build의 저장 폭의 정수배가 아니면 만들 수 없는 칸이다. 가장 가까운 폭으로
 * 눌러 담으면 화면이 요청하지 않은 눈금을 요청한 눈금이라고 믿는다.
 */
export class DistributionBinWidthInvalid extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(readonly requestedMilli: bigint, readonly storedMilli: bigint) {
    super(`Bin width ${requestedMilli.toString(10)} is not a multiple of the stored width ${storedMilli.toString(10)}`);
    this.name = "DistributionBinWidthInvalid";
  }
}

// 나쁜 순서다. SQL이 소유한 `WORST_COVERAGE_ORDER`와 같은 순서이며, 여기서는 달들의 판정을 하나로
// 접는 데 쓴다. 두 곳의 순서가 갈라지면 화면이 같은 build에 대해 다른 보유율을 본다.
const COVERAGE_RANK: Record<MartCoverage, number> = { none: 0, unknown: 1, partial: 2, complete: 3 };

type CohortCheck = Effect.Effect<
  void,
  AuctionDependencyUnavailable | DistributionRegionNotFound | OrganizationNotFound,
  never
>;

function rateMilli(rate: BidRate): bigint {
  const [whole, fraction = ""] = rate.split(".");
  return BigInt(whole) * 1000n + BigInt((fraction + "000").slice(0, 3));
}

function binResource(bin: DistributionBinCount, widthMilli: bigint): DistributionBin {
  return {
    from: { value: rateMilliText(bin.lowerMilli), unit: "percentage-points" },
    to: { value: rateMilliText(bin.lowerMilli + widthMilli), unit: "percentage-points" },
    count: bin.count,
  };
}

function boundaryResource(boundary: DistributionBinBoundary) {
  return {
    from: { value: rateMilliText(boundary.fromMilli), unit: "percentage-points" } as const,
    to: { value: rateMilliText(boundary.toMilli), unit: "percentage-points" } as const,
  };
}

function worstCoverage(values: readonly MartCoverage[]): MartCoverage | null {
  if (values.length === 0) return null;
  return values.reduce((worst, value) => (COVERAGE_RANK[value] < COVERAGE_RANK[worst] ? value : worst));
}

function metaResource(
  input: FindWinRateDistributionInput,
  period: { readonly from: KstMonth; readonly to: KstMonth },
  sampleCount: number,
  coverage: MartCoverage | null,
  lineage: MartBuildLineage | null,
): WinRateDistributionMeta {
  const organizationIdentity = cohortOrganizationId(input.cohort);
  const regionIdentity = cohortRegionCodeValueId(input.cohort);
  return {
    sampleCount,
    // 분포 mart에 품목 축이 없다는 사실을 자리를 비우는 대신 명시적 null로 말한다(설계 §3.2).
    item: null,
    scope: input.cohort.scope,
    regionCodeValueId: regionIdentity === null ? null : regionIdentity.toString(10),
    organizationId: organizationIdentity === null ? null : organizationIdentity.toString(10),
    floorRate: { value: input.floorRate, unit: "percentage-points" },
    awardMethod: input.awardMethodCodeValueId.toString(10),
    binWidth: { value: input.binWidth, unit: "percentage-points" },
    period: { from: period.from, to: period.to },
    // 계보는 행이 아니라 이 결과를 읽은 build 하나가 갖는다(ADR 0034).
    buildId: lineage === null ? null : lineage.buildId.toString(10),
    sourceReleaseId: lineage?.sourceReleaseId ?? null,
    calcVersion: lineage?.calcVersion ?? null,
    computedAt: lineage === null ? null : z.encode(instantCodec, lineage.computedAt),
    coverage,
    regionScheme: lineage?.regionScheme ?? null,
  };
}

export class FindWinRateDistribution {
  constructor(private readonly reader: WinRateDistributionReader, private readonly clock: Clock) {}

  execute(input: FindWinRateDistributionInput): Effect.Effect<
    WinRateDistributionV1Response,
    AuctionDependencyUnavailable | DistributionBinWidthInvalid | DistributionRegionNotFound | OrganizationNotFound,
    never
  > {
    const period = input.period ?? this.defaultPeriod();
    // 존재 확인을 먼저 끝내야 "그 모집단이 없음"과 "표본이 아직 없음"이 같은 빈 분포로 뭉개지지 않는다.
    return this.assertCohortExists(input.cohort).pipe(
      Effect.flatMap(() => Effect.tryPromise({
        try: () => this.reader.readDistribution({
          cohort: input.cohort,
          floorRate: input.floorRate,
          awardMethodCodeValueId: input.awardMethodCodeValueId,
          period,
        }),
        catch: (cause) => new AuctionDependencyUnavailable(cause),
      })),
      Effect.flatMap((reading) => this.serialize(input, period, reading)),
    );
  }

  /** 기본 창은 현재 시각의 함수라 정적 계약에 넣을 수 없다. 주입된 clock만 쓴다(AGENTS 17). */
  private defaultPeriod(): { readonly from: KstMonth; readonly to: KstMonth } {
    const to = kstMonthOf(this.clock.now());
    return { from: shiftKstMonth(to, -(DEFAULT_PERIOD_MONTHS - 1)), to };
  }

  private assertCohortExists(cohort: DistributionCohort): CohortCheck {
    // 전국은 확인할 축이 없다. 없는 축을 확인하려고 조회를 한 번 더 하면 그 자체가 실패 지점이 된다.
    if (cohort.scope === "national") return Effect.succeed(undefined);
    const missing: DistributionRegionNotFound | OrganizationNotFound = cohort.scope === "organization"
      ? new OrganizationNotFound(cohort.organizationId)
      : new DistributionRegionNotFound(cohort.regionCodeValueId);
    return Effect.tryPromise({
      try: () => this.reader.cohortExists(cohort),
      catch: (cause): AuctionDependencyUnavailable => new AuctionDependencyUnavailable(cause),
    }).pipe(Effect.flatMap((exists): CohortCheck => exists ? Effect.succeed(undefined) : Effect.fail(missing)));
  }

  private serialize(
    input: FindWinRateDistributionInput,
    period: { readonly from: KstMonth; readonly to: KstMonth },
    reading: DistributionReading,
  ): Effect.Effect<WinRateDistributionV1Response, DistributionBinWidthInvalid, never> {
    const widthMilli = rateMilli(input.binWidth);
    const stored = reading.storedBinWidthMilli;
    // 저장 폭보다 좁거나 배수가 아닌 칸은 만들 수 없다. 행이 없으면 검증할 대상 자체가 없다.
    if (stored !== null && (widthMilli < stored || widthMilli % stored !== 0n)) {
      return Effect.fail(new DistributionBinWidthInvalid(widthMilli, stored));
    }
    // 활성 build가 없으면 계보도 달도 없다. 오류가 아니라 파생물이 아직 없는 정상 상태다(ADR 0011).
    if (reading.lineage === null) {
      return Effect.succeed({
        bins: [],
        medianBin: null,
        modeRange: null,
        months: [],
        meta: metaResource(input, period, 0, null, null),
      });
    }
    const coverageByMonth = new Map(reading.coverage.map((entry) => [entry.month, entry.coverage] as const));
    const binsByMonth = new Map(reading.months.map((entry) => [entry.month, entry.bins] as const));
    const months = kstMonthsBetween(period.from, period.to).map((month) => {
      const summary = summarizeDistribution(binsByMonth.get(month) ?? [], widthMilli);
      return {
        month,
        sampleCount: summary.sampleCount,
        // 보유율 행이 없는 달은 "완전"이 아니라 `none`이다. 행이 없다는 것이 곧 none이며 그 번역은
        // 읽기 경로가 한다(PDR-0003).
        coverage: coverageByMonth.get(month) ?? ("none" as MartCoverage),
        bins: input.granularity === "month" ? summary.bins.map((bin) => binResource(bin, widthMilli)) : null,
      };
    });
    const total: DistributionSummary = summarizeDistribution(
      reading.months.flatMap((entry) => entry.bins),
      widthMilli,
    );
    return Effect.succeed({
      bins: total.bins.map((bin) => binResource(bin, widthMilli)),
      medianBin: total.medianBin === null ? null : boundaryResource(total.medianBin),
      modeRange: total.modeRange === null ? null : {
        ...boundaryResource(total.modeRange),
        count: total.modeRange.count,
        share: { value: ratioMillionthsText(total.modeRange.shareMillionths), unit: "ratio" },
      },
      months,
      meta: metaResource(
        input,
        period,
        total.sampleCount,
        worstCoverage(months.map((month) => month.coverage)),
        reading.lineage,
      ),
    });
  }
}
