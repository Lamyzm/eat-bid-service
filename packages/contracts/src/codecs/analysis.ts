/** @module 책임: 공통 분석 wire를 검증한 뒤 날짜·범위·지원 코드·표본과 스냅샷의 의미 경계를 검사한다. */
import { analysisDateRange, analysisListCountRange, analysisPublicationFreshness, sampleCount, Temporal } from "@eatbid/domain";
import {
  analysisFilterValueSchema, analysisFilterOptionsSchema, analysisMetaSchema,
  type AnalysisFilterValue, type AnalysisFilterOptions, type AnalysisMeta,
} from "../api/v1/analysis";

/** 실행 의미 검증을 portable schema에 넣지 않는다. 최종 API adapter는 wire parse만으로 요청을 승인하지 않는다. */
export function parseAnalysisFilterValue(input: unknown): AnalysisFilterValue {
  const filter = analysisFilterValueSchema.parse(input);
  analysisDateRange(Temporal.PlainDate.from(filter.period.from), Temporal.PlainDate.from(filter.period.to));
  analysisListCountRange(
    filter.listCountRange.min === null ? null : sampleCount(BigInt(filter.listCountRange.min)),
    filter.listCountRange.max === null ? null : sampleCount(BigInt(filter.listCountRange.max)),
  );
  return filter;
}

/** 선택지의 관측 양끝도 사용자 입력과 같은 달력 규칙을 따른다. null은 확인되지 않은 범위로 유지한다. */
export function parseAnalysisFilterOptions(input: unknown): AnalysisFilterOptions {
  const options = analysisFilterOptionsSchema.parse(input);
  for (const period of Object.values(options.availablePeriods)) {
    if (period !== null) analysisDateRange(Temporal.PlainDate.from(period.from), Temporal.PlainDate.from(period.to));
  }
  return options;
}

/** 선택지는 같은 조회 시점의 서버 확인값이어야 한다. 사용자가 제출한 선택지나 라벨로 존재·권한을 판단하지 않는다. */
export function assertAnalysisFilterSupported(filter: AnalysisFilterValue, inputOptions: AnalysisFilterOptions): void {
  const options = parseAnalysisFilterOptions(inputOptions);
  const region = filter.comparisonScope;
  if (region.kind === "region" && !options.regions.some((value) => value.active && value.codeValueId === region.codeValueId && value.scheme === region.scheme)) {
    throw new RangeError("확인된 활성 공고지역이 아닙니다.");
  }
  if (!options.floorRates.some((rate) => rate.value === filter.floorRate.value)) throw new RangeError("지원하는 하한율이 아닙니다.");
  if (!options.awardMethods.some((method) => method.codeValueId === filter.awardMethodCodeValueId)) throw new RangeError("확인된 낙찰방식이 아닙니다.");
  // 품목은 여기서 다시 확인하지 않는다. 값이 코드값 id가 아니라 계약 안의 원자 여덟이라 schema가
  // 이미 어휘 밖을 끊었고, 서버가 확인해 줄 "지원 여부"라는 것이 따로 없다(PDR-0007).
}

/** 여러 mart의 build 번호는 달라도 된다. 실제 입력 집합 검증은 발급자가 수행하며 이 함수는 구조적 의미만 검증한다. */
export function parseAnalysisMeta(input: unknown): AnalysisMeta {
  const meta = analysisMetaSchema.parse(input);
  parseAnalysisFilterValue(meta.effectiveFilter);
  if (meta.state !== "ready") return meta;
  if (meta.overlapCount > Math.min(meta.targetSampleCount, meta.comparisonSampleCount)) throw new RangeError("겹침 수가 집단 표본 수를 넘습니다.");
  // 전국은 같은 공통 조건의 전체 품목이다. 기관 품목을 좁혀도 기관 관측은 전국의 부분집합이어야 한다.
  if (meta.effectiveFilter.comparisonScope.kind === "national" && meta.overlapCount !== meta.targetSampleCount) {
    throw new RangeError("전국 비교에 기관 표본 전체가 포함되지 않았습니다.");
  }
  const { snapshot } = meta;
  const issuedAt = Temporal.Instant.from(snapshot.issuedAt);
  if (Temporal.Instant.compare(Temporal.Instant.from(snapshot.sourceCutoffAt), issuedAt) > 0 || Temporal.Instant.compare(issuedAt, Temporal.Instant.from(snapshot.expiresAt)) >= 0) {
    throw new RangeError("스냅샷 입력·발급·보존 시각 순서가 잘못됐습니다.");
  }
  if (new Set(snapshot.builds.map((build) => build.purpose)).size !== snapshot.builds.length) throw new RangeError("스냅샷 build 역할이 중복됐습니다.");
  if (!snapshot.builds.some((build) => build.purpose === "observations")) throw new RangeError("관측 자료의 build가 없습니다.");
  for (const build of snapshot.builds) {
    if (Temporal.Instant.compare(Temporal.Instant.from(build.lineage.computedAt), issuedAt) > 0) throw new RangeError("발급 시각 이후의 build를 참조했습니다.");
  }
  let nextDate = Temporal.PlainDate.from(meta.effectiveFilter.period.from);
  for (const segment of meta.periodCoverage) {
    const from = Temporal.PlainDate.from(segment.period.from);
    const to = Temporal.PlainDate.from(segment.period.to);
    analysisDateRange(from, to);
    if (!nextDate.equals(from)) throw new RangeError("수집 상태 기간에 누락 또는 중복이 있습니다.");
    nextDate = to.add({ days: 1 });
  }
  if (!nextDate.equals(Temporal.PlainDate.from(meta.effectiveFilter.period.to).add({ days: 1 }))) throw new RangeError("수집 상태가 조회 기간 전체를 설명하지 않습니다.");
  if (meta.freshness.state === "updating" || meta.freshness.state === "delayed") {
    const expected = analysisPublicationFreshness(Temporal.Instant.from(meta.freshness.checkedAt), Temporal.Instant.from(meta.freshness.oldestPendingPublicationAt));
    if (meta.freshness.state !== expected) {
      throw new RangeError("미반영 발행의 경과와 갱신 상태가 다릅니다.");
    }
  }
  return meta;
}
