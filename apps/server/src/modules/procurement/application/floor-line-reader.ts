/**
 * @module 책임: 하한선 자리(PDR-0009)가 읽는 공고별 하한선·1~10등 사다리·지역 목록 port와 그 레코드를 정의한다.
 *
 * 분석 코호트(`AnalysisCohortQuery`)를 쓰지 않는 이유는 모집단이 다르기 때문이다. 분석은 낙찰 사정률이 관측된 회차만 보지만,
 * 하한선은 예정가격이 정해진 모든 개찰 회차에 있다 — 유찰된 공고도 그날 하한선은 그어졌다.
 */
import type { BaseRelativeBidRate, Money, Temporal } from "@eatbid/domain";

import type { MartBuildLineage } from "./mart-build-lineage";

/** 개찰 시각 `[from, before)`와 하한율(milli)이다. 하한율이 다른 공고는 하한선의 축이 달라 섞지 않는다. */
export interface FloorLineWindow {
  readonly from: Temporal.Instant;
  readonly before: Temporal.Instant;
  readonly floorRateMilli: bigint;
}

export interface FloorLinePointRecord {
  readonly attemptId: bigint;
  readonly revisionId: bigint;
  readonly openedAt: Temporal.Instant;
  readonly organizationName: string | null;
  readonly baseAmount: Money;
  /** 예정가격 × 하한율 ÷ 기초금액이다. DB의 정확한 10진 연산으로 소수 넷째 자리에서 반올림한다. */
  readonly floor: BaseRelativeBidRate;
}

export interface FloorLineLadderRecord {
  readonly attemptId: bigint;
  /** 하한 위로 낸 업체 수다. 업체마다 가장 낮게 낸 값 하나만 센다. */
  readonly validBidderCount: number;
  /** 하한 위로 낸 값을 낮은 순으로 열 곳까지 둔 기초금액 대비율이다. */
  readonly lowest: readonly BaseRelativeBidRate[];
}

export interface FloorLineRegionRecord {
  readonly sidoCodeValueId: bigint;
  readonly sidoLabel: string | null;
  readonly sigunguCodeValueId: bigint;
  readonly sigunguLabel: string | null;
  readonly pointCount: number;
}

export interface FloorLineReader {
  /** 지금 활성인 회차 요약 build의 계보다. 없으면 파생물이 아직 없는 것이다. */
  activeLineage(): Promise<MartBuildLineage | null>;
  /** 공고지역 시군구 코드값의 가장 나중 관측 이름이다. 없으면 null이다. */
  regionLabel(sigunguCodeValueId: bigint): Promise<string | null>;
  readPoints(window: FloorLineWindow, sigunguCodeValueId: bigint): Promise<readonly FloorLinePointRecord[]>;
  /** 같은 조건의 회차마다 1~10등 사다리다. 명단이 관측되지 않은 회차는 빠진다. */
  readLadders(window: FloorLineWindow, sigunguCodeValueId: bigint): Promise<readonly FloorLineLadderRecord[]>;
  readRegions(window: FloorLineWindow): Promise<readonly FloorLineRegionRecord[]>;
}
