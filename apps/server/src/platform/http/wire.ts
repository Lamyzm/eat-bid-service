/**
 * @module 책임: 모듈을 가로지르는 wire 변환(시각 문자열, 십진 식별자, 축별 비율 봉투, 코드 참조, mart 계보)을
 * 한 벌로 소유해 presenter마다 같은 직렬화가 다시 생기지 않게 한다.
 *
 * 모듈끼리 내부 계층을 import하지 않는다는 정책은 그대로이며 이 파일은 모듈이 아니라 platform이라 어느
 * 모듈의 presenter든 쓴다. contracts에 codec이 있는 값(시각)은 그 codec을 쓰고 여기서 다시 만들지 않는다
 * (ADR 0045 결정 2).
 */
import {
  instantCodec,
  type BaseRelativeBidRateWire,
  type BidRateWire,
  type CodeReference,
  type MartBuildLineageWire,
  type MartCoverage,
  type ObservedBidRateWire,
} from "@eatbid/contracts";
import type { BaseRelativeBidRate, BidRate, ObservedBidRate, Temporal } from "@eatbid/domain";
import { z } from "zod";

/** 시각은 contracts의 `instantCodec` 한 벌로만 encode한다. `toString`을 직접 부르면 canonical 형태 검증이 빠진다. */
export function instantText(value: Temporal.Instant): string;
export function instantText(value: Temporal.Instant | null): string | null;
export function instantText(value: Temporal.Instant | null): string | null {
  return value === null ? null : z.encode(instantCodec, value);
}

/** PostgreSQL bigint 식별자는 Number를 거치면 정밀도가 손실되므로 경계에서 십진 문자열로만 직렬화한다. */
export function bigintText(value: bigint): string;
export function bigintText(value: bigint | null): string | null;
export function bigintText(value: bigint | null): string | null {
  return value === null ? null : value.toString(10);
}

// 아래 세 비율 축은 단위 문자열이 같아도 분모가 다르다(사정률 상수·관측 사정률·기초금액 분모). 한 함수로
// 합치면 타입이 그 차이를 더 막지 못하므로 축마다 둔다. scale과 범위는 어댑터의 값 팩토리가 이미 닫았고,
// 여기서 다시 만들면 같은 불변식이 두 곳에 생겨 한쪽만 바뀔 때 조용히 갈라진다.
export function bidRateWire(value: BidRate): BidRateWire;
export function bidRateWire(value: BidRate | null): BidRateWire | null;
export function bidRateWire(value: BidRate | null): BidRateWire | null {
  return value === null ? null : { value, unit: "percentage-points" };
}

export function observedBidRateWire(value: ObservedBidRate): ObservedBidRateWire;
export function observedBidRateWire(value: ObservedBidRate | null): ObservedBidRateWire | null;
export function observedBidRateWire(value: ObservedBidRate | null): ObservedBidRateWire | null {
  return value === null ? null : { value, unit: "percentage-points" };
}

export function baseRelativeBidRateWire(value: BaseRelativeBidRate): BaseRelativeBidRateWire;
export function baseRelativeBidRateWire(value: BaseRelativeBidRate | null): BaseRelativeBidRateWire | null;
export function baseRelativeBidRateWire(value: BaseRelativeBidRate | null): BaseRelativeBidRateWire | null {
  return value === null ? null : { value, unit: "percentage-points" };
}

/**
 * presenter가 넘기는 모듈 application record가 만족해야 할 최소 구조다. platform이 모듈의 application
 * 타입을 import하면 의존 방향이 뒤집히므로 구조로만 받고, 필드를 명시해 record에 열이 늘어도 strict wire에
 * 새지 않게 한다.
 */
interface CodeReferenceLike {
  readonly codeValueId: bigint;
  readonly code: string;
  readonly scheme: string;
  readonly label: string | null;
}

export function codeReferenceWire(value: CodeReferenceLike): CodeReference;
export function codeReferenceWire(value: CodeReferenceLike | null): CodeReference | null;
export function codeReferenceWire(value: CodeReferenceLike | null): CodeReference | null {
  return value === null
    ? null
    : { codeValueId: bigintText(value.codeValueId), code: value.code, scheme: value.scheme, label: value.label };
}

interface MartBuildLineageLike {
  readonly buildId: bigint;
  readonly sourceReleaseId: string;
  readonly calcVersion: string;
  readonly computedAt: Temporal.Instant;
  readonly coverage: MartCoverage | null;
  readonly regionScheme: string | null;
}

/** 활성 build가 없으면 계보를 지어내지 않고 전부 null로 남긴다 — 파생물이 없는 것은 오류가 아니다(ADR 0011, ADR 0034). */
export function martBuildLineageWire(lineage: MartBuildLineageLike | null): MartBuildLineageWire {
  return {
    buildId: lineage === null ? null : bigintText(lineage.buildId),
    sourceReleaseId: lineage?.sourceReleaseId ?? null,
    calcVersion: lineage?.calcVersion ?? null,
    computedAt: lineage === null ? null : instantText(lineage.computedAt),
    coverage: lineage?.coverage ?? null,
    regionScheme: lineage?.regionScheme ?? null,
  };
}
