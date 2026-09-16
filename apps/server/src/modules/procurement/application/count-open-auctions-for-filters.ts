/**
 * @module 책임: 필터 한 벌 여럿의 열린 공고 건수를 한 번에 세는 port와 그 결과 record를 정의하고, 기준 시각을 주입된 clock에서 한 번만 읽는다.
 *
 * 저장된 조합이 누구 것인지는 account가 소유하고, **몇 건인지는 여기가 소유한다.** 열린 공고 mart와
 * 열림 술어가 이 모듈에 있기 때문이다. 이 use case는 조합이라는 말을 모르고 필터 한 벌만 받는다.
 */
import type { AuctionItemAtom } from "@eatbid/contracts";
import { Effect } from "effect";

import type { Clock, Temporal } from "@eatbid/domain";

import { ProcurementDependencyUnavailable } from "./failures";
import type { MartBuildLineage } from "./mart-build-lineage";

/** 세는 대상 한 벌이다. 목록 query와 같은 축을 쓰며 날짜 축은 없다 — 조합은 집합이 아니라 조건이다. */
export interface OpenAuctionFilterSet {
  readonly sidoCodeValueId: bigint | null;
  readonly sigunguCodeValueIds: readonly bigint[] | null;
  readonly itemAtoms: readonly AuctionItemAtom[] | null;
  readonly baseAmountMin: string | null;
  readonly baseAmountMax: string | null;
}

export interface OpenAuctionFilterCountsQuery {
  readonly asOf: Temporal.Instant;
  /** 워크스페이스가 확인한 관심 지역이다. 아홉 수 전부의 바닥이라 조합마다 다시 걸지 않는다. */
  readonly eligibilityAreaCodeValueIds: readonly bigint[] | null;
  /** 지금 화면 조건이다. 기본 넷 중 둘이 이 조건에서의 이동이라 함께 받아야 센다. */
  readonly current: OpenAuctionFilterSet;
  readonly saved: readonly OpenAuctionFilterSet[];
}

export interface OpenAuctionFilterCountsRecord {
  /** 관심 지역만 건 수. 조건을 좁힌 채로도 내 지역의 판이 얼마나 큰지 보인다. */
  readonly regionAll: number;
  readonly regionClosingToday: number;
  /** 지금 조건에서 아직 아무도 안 들어온 판. 참여 수 미관측은 0이 아니라 못 센 것이라 빠진다. */
  readonly noBids: number;
  /** 지금 조건에 품목을 관측하지 못한 행까지 더한 수. 품목 축을 안 걸었으면 지금 조건과 같다. */
  readonly itemUnknownIncluded: number;
  /** 요청한 순서 그대로다. 이름이 아니라 위치로 짝짓는다 — 조합 이름은 사용자 문자열이다(AGENTS 2). */
  readonly saved: readonly number[];
  readonly snapshotLineage: MartBuildLineage | null;
}

export interface OpenAuctionFilterCountsReader {
  countForFilters(query: OpenAuctionFilterCountsQuery): Promise<OpenAuctionFilterCountsRecord>;
}

export interface OpenAuctionFilterCountsResult {
  readonly asOf: Temporal.Instant;
  readonly counts: OpenAuctionFilterCountsRecord;
}

export class CountOpenAuctionsForFilters {
  constructor(private readonly reader: OpenAuctionFilterCountsReader, private readonly clock: Clock) {}

  /**
   * 기준 시각을 요청당 한 번만 읽는다. 아홉 수가 서로 다른 "지금"을 보면 조합 옆의 수와 그 조합을
   * 눌렀을 때의 목록이 어긋나고, 응답의 `meta.asOf`도 아홉 중 어느 것의 것인지 말할 수 없다(AGENTS 7·17).
   */
  execute(input: {
    readonly eligibilityAreaCodeValueIds: readonly bigint[] | null;
    readonly current: OpenAuctionFilterSet;
    readonly saved: readonly OpenAuctionFilterSet[];
  }): Effect.Effect<OpenAuctionFilterCountsResult, ProcurementDependencyUnavailable> {
    const asOf = this.clock.now();
    return Effect.tryPromise({
      try: () => this.reader.countForFilters({ asOf, ...input }),
      catch: (cause) => new ProcurementDependencyUnavailable(cause),
    }).pipe(Effect.map((counts) => ({ asOf, counts })));
  }
}
