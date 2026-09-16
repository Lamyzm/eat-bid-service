/** @module 책임: 열린 공고 목록 조회 use case의 실패 분류와 "열림" 기준 시각 확정을 소유한다. */
import type { AuctionItemAtom } from "@eatbid/contracts";
import type { Clock } from "@eatbid/domain";
import { Effect } from "effect";
import { ProcurementDependencyUnavailable } from "./failures";
import type { OpenAuctionPage, OpenAuctionQuery, OpenAuctionReader } from "./open-auction-reader";

/**
 * cursor는 활성 스냅샷 build의 열린 공고만 가리킨다. build 전환으로 사라진 cursor를 빈 목록으로 답하면
 * 화면이 "끝"과 "목록이 갱신됨"을 구분하지 못하므로 요청 오류로 닫는다. EAT-37의 `AttemptCursorInvalid`와
 * 모양이 같지만 소유자(기관 이력 vs 열린 목록)가 달라 합치지 않는다.
 */
export class OpenAuctionCursorInvalid extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(readonly cursor: bigint) {
    super(`Cursor ${cursor.toString(10)} is not an open auction in the active snapshot build`);
    this.name = "OpenAuctionCursorInvalid";
  }
}

/** HTTP query에서 온 조회 입력이다. 기준 시각은 여기 없고 use case가 clock에서 읽어 reader query로 옮긴다. */
export interface ListOpenAuctionsInput {
  readonly sidoCodeValueId: bigint | null;
  readonly sigunguCodeValueIds: readonly bigint[] | null;
  /** 시도 축이 걸렸을 때 공고지역 미관측 행을 함께 낼지다. 목록과 요약이 같은 술어를 쓴다(EAT-260). */
  readonly includeUnknownRegion: boolean;
  readonly eligibilityAreaCodeValueIds: readonly bigint[] | null;
  /** 품목 조각들이다. 한 조각이라도 라벨 안에 들어 있으면 걸린다(부분일치 OR). */
  readonly itemAtoms: readonly AuctionItemAtom[] | null;
  readonly includeUnknownItem: boolean;
  readonly searchText: string | null;
  readonly onlyWithoutBids: boolean;
  readonly closesWithinHours: number | null;
  readonly closesOnKst: string | null;
  readonly announcedOnKst: string | null;
  readonly baseAmountMin: string | null;
  readonly baseAmountMax: string | null;
  readonly cursor: bigint | null;
  readonly limit: number;
}

/**
 * presenter가 응답 meta에 요청 필터와 열림 기준 시각을 되돌려 실어야 표본 수가 어느 코호트의 수인지
 * 응답만으로 재현된다(AGENTS 7). 그래서 페이지와 함께 reader에 실제로 넘긴 query를 돌려준다.
 */
export interface OpenAuctionListResult {
  readonly query: OpenAuctionQuery;
  readonly page: OpenAuctionPage;
}

export class ListOpenAuctions {
  constructor(private readonly reader: OpenAuctionReader, private readonly clock: Clock) {}

  execute(input: ListOpenAuctionsInput): Effect.Effect<
    OpenAuctionListResult,
    OpenAuctionCursorInvalid | ProcurementDependencyUnavailable,
    never
  > {
    // "열림"은 현재 시각의 함수라 정적 계약에 넣을 수 없다. 주입된 clock을 요청당 한 번만 읽어 페이지·표본
    // 수·다음 페이지 판정이 같은 기준 시각을 쓰게 한다(AGENTS 17).
    const query: OpenAuctionQuery = { ...input, asOf: this.clock.now() };
    return Effect.tryPromise({
      try: () => this.reader.listOpen(query),
      catch: (cause) => new ProcurementDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((listing) => listing.kind === "page"
        ? Effect.succeed({ query, page: listing.page })
        : Effect.fail(new OpenAuctionCursorInvalid(listing.cursor))),
    );
  }
}
