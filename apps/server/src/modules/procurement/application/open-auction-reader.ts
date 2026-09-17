/** @module 책임: 열린 공고 목록 조회 port와 스냅샷 한 행·(기관, 하한율) 코호트 요약의 application record 형태를 소유한다. */
import type { AuctionItemAtom } from "@eatbid/contracts";
import type { BaseRelativeBidRate, BidRate, Money, Temporal } from "@eatbid/domain";
import type { CodeReferenceRecord } from "./auction-reader";
import type { MartBuildLineage } from "./mart-build-lineage";

/**
 * 이 행과 같은 하한율에서 이 기관이 가장 최근에 개찰한 회차 하나다. 다섯 값이 같은 회차에서 와야 화면이
 * 없는 회차를 말하지 않는다. 비율은 투찰률 축(기초금액 분모)이며 사정률 축은 여기 싣지 않는다(PDR-0004).
 */
export interface OpenAuctionLastRoundRecord {
  readonly auctionAttemptId: bigint;
  readonly openedAt: Temporal.Instant;
  readonly awardedBidRate: BaseRelativeBidRate | null;
  readonly dayFloorBidRate: BaseRelativeBidRate | null;
  readonly listCount: number | null;
  readonly belowDayFloorCount: number | null;
}

/**
 * (기관, 하한율) 코호트 하나의 요약이다. 코호트를 만들 수 없는 행 — 기관 미확인이거나 하한율 미관측 — 은
 * `orgSummary`가 통째로 null이고, 코호트는 있는데 회차가 0건인 것은 `attemptCount = 0`으로 남긴다.
 */
export interface OpenAuctionOrgSummaryRecord {
  readonly attemptCount: number;
  readonly medianListCount: number | null;
  readonly listCountSampleCount: number;
  readonly lastRound: OpenAuctionLastRoundRecord | null;
}

/**
 * mart.open_auction_snapshot 한 행을 도메인 값으로만 표현한다. `label`은 조직 코드의 관측 라벨이지
 * canonical_name이 아니다(EAT-39 판정 G). 상세 파생 열(품목·하한율·지역)은 `termsRevisionId`가 있을
 * 때만 값을 가지며, 그 계보 없이 값이 앉는 것은 표의 check가 막는다.
 */
export interface OpenAuctionRecord {
  readonly auctionAttemptId: bigint;
  readonly organization: {
    readonly organizationId: bigint;
    readonly label: string | null;
    readonly type: string;
  } | null;
  readonly itemLabel: string | null;
  /** 원천이 표시하는 공고 제목 관측이다. 상세를 아직 따지 않은 공고는 null이다(EAT-260). */
  readonly title: string | null;
  /** 원천이 표시하는 공고번호다. 표시·복사용 문자열이며 정체성은 `auctionAttemptId`다(AGENTS 2, EAT-248). */
  readonly displayBidNo: string | null;
  /** 단독입찰 처리 방법 코드 참조다. null은 미관측(eat-v4 전 해석)이지 "허용함"이 아니다(AGENTS 3, EAT-249). */
  readonly soloBidMethod: CodeReferenceRecord | null;
  /** 게시 종류 코드 참조다. null은 미관측(eat-v5 전 해석)이지 "일반공고"가 아니다(AGENTS 3, EAT-262). */
  readonly changeKind: CodeReferenceRecord | null;
  readonly floorRate: BidRate | null;
  readonly region: {
    readonly sido: CodeReferenceRecord | null;
    readonly sigungu: CodeReferenceRecord | null;
  } | null;
  /**
   * 참가제한지역 관측이다. 위 `region`(공고지역)과 다른 체계이며 섞어 읽지 않는다(AGENTS 6).
   * `null`은 "제한 없음"이 아니라 관측하지 못했다는 뜻이다(AGENTS 3).
   */
  readonly eligibilityAreas: readonly CodeReferenceRecord[] | null;
  readonly termsRevisionId: bigint | null;
  readonly closesAt: Temporal.Instant | null;
  readonly baseAmount: Money | null;
  readonly bidCount: number | null;
  readonly observedAt: Temporal.Instant;
  readonly sourceLastChangedAt: Temporal.Instant | null;
  readonly orgSummary: OpenAuctionOrgSummaryRecord | null;
}

export interface OpenAuctionQuery {
  /**
   * "열림"의 기준 시각이다. use case가 주입된 clock에서 한 번 읽어 넘기므로 어댑터가 `now()`를
   * SQL에서 부르지 않는다 — 그러면 같은 요청의 목록·표본 수가 서로 다른 시각을 본다(AGENTS 15·17).
   */
  readonly asOf: Temporal.Instant;
  /**
   * 공고지역 축이다. **시도 하나 + 그 안의 시군구 여럿**이며 시군구만 단독으로 오지 않는다.
   * 시군구가 비면 그 시도 전체이고, `sidoCodeValueId`가 `null`이면 지역 필터가 없다.
   */
  readonly sidoCodeValueId: bigint | null;
  readonly sigunguCodeValueIds: readonly bigint[] | null;
  /** 참이면 시도 축을 걸어도 공고지역 미관측 행을 함께 낸다. 시도 축이 없으면 아무 일도 하지 않는다(EAT-260). */
  readonly includeUnknownRegion: boolean;
  /**
   * 참가제한지역 필터다. `null`은 필터 없음이고 빈 배열은 "고른 지역이 없다"라서 서로 다른 요청이다.
   * 저장된 코드 집합이 곧 매칭 집합이며 질의가 스스로 넓히지 않는다(ADR 0048 결정 2).
   */
  readonly eligibilityAreaCodeValueIds: readonly bigint[] | null;
  /** 품목 조각들이다. 한 조각이라도 라벨 안에 들어 있으면 걸린다(부분일치 OR). */
  readonly itemAtoms: readonly AuctionItemAtom[] | null;
  /** 참이면 품목 축을 걸어도 라벨 미관측 행을 함께 낸다. 품목 축이 없으면 아무 일도 하지 않는다. */
  readonly includeUnknownItem: boolean;
  /** 검색어다. 제목·기관 이름·공고번호 안의 부분일치이며 다른 축 안에서만 찾는다. `null`은 검색 없음이다. */
  readonly searchText: string | null;
  /** 참이면 관측된 참여 수가 0인 행만 낸다. 미관측(null)은 0이 아니라 못 센 것이라 빠진다. */
  readonly onlyWithoutBids: boolean;
  readonly closesWithinHours: number | null;
  /**
   * KST 달력일로 자르는 축 둘이다. 위 시간 창과 함께 올 수 없다 — 시간 창은 달력일을 대신하지 못한다.
   * `announcedOnKst`는 상세에서 온 게시일을 보므로 상세를 아직 따지 않은 공고는 걸리지 않는다.
   */
  readonly closesOnKst: string | null;
  readonly announcedOnKst: string | null;
  // canonical decimal text다. 통화가 하나뿐인 필터 경계라 Money로 감싸지 않고 어댑터가 numeric 비교로 닫는다.
  readonly baseAmountMin: string | null;
  readonly baseAmountMax: string | null;
  readonly cursor: bigint | null;
  readonly limit: number;
}

/**
 * `sampleCount`는 cursor 위치와 무관하게 필터를 만족하는 열린 공고 전체 수다.
 * 계보는 둘이다. 행은 스냅샷 build, 기관 요약은 회차 요약 build에서 오며 어느 쪽도 아직 빌드된 적이
 * 없으면 null이고 그것은 오류가 아니다(ADR 0011, ADR 0034).
 */
export interface OpenAuctionPage {
  readonly auctions: readonly OpenAuctionRecord[];
  readonly nextCursor: bigint | null;
  readonly sampleCount: number;
  /** 표본 안에서 고른 지역이 실제로 잡은 행 수와, 제한지역을 관측하지 못해 남긴 행 수다. 합이 표본 수다. */
  readonly eligibilityMatchedCount: number;
  readonly eligibilityUnobservedCount: number;
  readonly snapshotLineage: MartBuildLineage | null;
  readonly orgSummaryLineage: MartBuildLineage | null;
}

/**
 * cursor는 활성 스냅샷 build 안의 열린 공고만 가리켜야 한다. build가 30분마다 바뀌므로 사라진 cursor는
 * 드물지 않으며, 그것을 빈 페이지로 돌려주면 호출자가 "끝"과 "목록이 갱신됨"을 구분하지 못한다.
 */
export type OpenAuctionListing =
  | { readonly kind: "page"; readonly page: OpenAuctionPage }
  | { readonly kind: "cursor-not-found"; readonly cursor: bigint };

export interface OpenAuctionReader {
  listOpen(query: OpenAuctionQuery): Promise<OpenAuctionListing>;
}
