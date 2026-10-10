/**
 * @module 책임: 요청자 워크스페이스의 관심 지역에서 오늘·내일 마감하는 하한율 90·88 공고를 고르고, 공고마다 전국 공식과 이번 달 맞춤
 * 금액(두 장·한 장·예비)을 계산하는 오늘 투찰 use case와 그 내부 record를 소유한다.
 */
import type { AuctionItemAtom } from "@eatbid/contracts";
import { Temporal, type Clock } from "@eatbid/domain";
import { Effect } from "effect";

import type { ResolvedPrincipal } from "../../../platform/auth/principal-reader";
import type { RegionPreferenceRepository } from "../../account/application/region-preference-repository";
import { positionAmount, positionBaseRelativeRate, positionBids, type BidPositionResult } from "../domain/bid-position-rule";
import { KST_TIME_ZONE } from "../domain/kst-month";
import type { MarketPickPosition, MarketPickResult } from "../domain/market-position-pick";
import { marketPickFor, type DecideMarketPick, type MarketPickDecision } from "./decide-market-pick";
import { ProcurementDependencyUnavailable } from "./failures";
import type { OpenAuctionReader, OpenAuctionRecord } from "./open-auction-reader";

/** 열린 공고 목록 한 장의 상한과 같다. 오늘·내일 마감 관심 지역 공고는 성수기 하루에도 이 안에 든다(2026-09-21 김해 91건). */
const BOARD_LIMIT = 200;
/** 이 조각이 다루는 하한율이다. 88은 금액을 화면에 보이지 않지만 공고는 목록에 남긴다(PDR-0008). */
const BOARD_FLOOR_RATES: readonly string[] = ["90.000", "88.000"];

export interface MyBidBoardRowRecord {
  readonly auction: OpenAuctionRecord;
  /** 기초금액이 관측되지 않았으면 null이다. 행을 빼면 공고를 놓친다. */
  readonly rule: BidPositionResult | null;
  readonly market: { readonly result: MarketPickResult; readonly spares: readonly MarketPickPosition[] } | null;
}

export type MyBidBoardRecord =
  | { readonly state: "unconfirmed"; readonly asOf: Temporal.Instant }
  | {
    readonly state: "confirmed";
    readonly asOf: Temporal.Instant;
    /** 이 KST 날짜 0시 전에 마감하는 공고만 담았다 — 오늘과 내일이다. */
    readonly closesBeforeDate: string;
    readonly decision: MarketPickDecision;
    readonly rows: readonly MyBidBoardRowRecord[];
  };

export interface GetMyBidBoardInput {
  readonly principal: ResolvedPrincipal;
  readonly itemAtoms: readonly AuctionItemAtom[] | null;
  readonly includeUnknownItem: boolean;
}

/**
 * 관심 지역은 query가 아니라 저장소에서 읽는다. 화면이 보낸 지역으로 남의 시장을 펼치지 않게 하는 것은 조합 건수 operation과
 * 같은 이유다(PDR-0001). "오늘·내일"은 KST 달력이다 — UTC로 자르면 밤 9시 이후 요청이 하루 밀린다.
 */
export class GetMyBidBoard {
  constructor(
    private readonly reader: OpenAuctionReader,
    private readonly regions: RegionPreferenceRepository,
    private readonly decideMarketPick: DecideMarketPick,
    private readonly clock: Clock,
  ) {}

  execute(input: GetMyBidBoardInput): Effect.Effect<MyBidBoardRecord, ProcurementDependencyUnavailable> {
    return Effect.tryPromise({
      try: () => this.read(input),
      catch: (cause) => new ProcurementDependencyUnavailable(cause),
    });
  }

  private async read(input: GetMyBidBoardInput): Promise<MyBidBoardRecord> {
    // 요청당 한 번 읽는다. 창·열림 판정·맞춤 달이 같은 기준 시각을 쓴다(AGENTS 17).
    const asOf = this.clock.now();
    const preference = await this.regions.readPreference(input.principal.workspace.workspaceId);
    if (preference.confirmedAt === null) return { state: "unconfirmed", asOf };

    const today = asOf.toZonedDateTimeISO(KST_TIME_ZONE).toPlainDate();
    const closesBeforeDate = today.add({ days: 2 });
    const closesBefore = closesBeforeDate.toZonedDateTime(KST_TIME_ZONE).toInstant();
    // 목록 reader는 시간 창만 받는다. 올림한 만큼 넘친 행은 아래에서 날짜 경계로 다시 자른다.
    const hours = Math.min(720, Math.max(1, Math.ceil(asOf.until(closesBefore).total({ unit: "hours" }))));

    const listing = await this.reader.listOpen({
      asOf,
      sidoCodeValueId: null,
      sigunguCodeValueIds: null,
      includeUnknownRegion: false,
      eligibilityAreaCodeValueIds: preference.areas.map((area) => area.codeValueId),
      itemAtoms: input.itemAtoms,
      includeUnknownItem: input.includeUnknownItem,
      searchText: null,
      onlyWithoutBids: false,
      closesWithinHours: hours,
      closesOnKst: null,
      announcedOnKst: null,
      baseAmountMin: null,
      baseAmountMax: null,
      cursor: null,
      limit: BOARD_LIMIT,
    });
    // cursor를 보내지 않으므로 사라진 cursor는 일어날 수 없다. 일어나면 계약 위반이라 장애로 닫는다.
    if (listing.kind !== "page") throw new Error("cursor 없이 보낸 목록 조회가 cursor 오류를 냈다");

    const auctions = listing.page.auctions.filter((auction) =>
      auction.closesAt !== null
      && Temporal.Instant.compare(auction.closesAt, closesBefore) < 0
      && auction.floorRate !== null
      && BOARD_FLOOR_RATES.includes(auction.floorRate));

    // 배수는 공고와 무관해 한 번만 고른다. 하한율이 섞여 있어 하한율을 넘기지 않는다.
    const decision = await this.decideMarketPick.decide({ workspaceId: input.principal.workspace.workspaceId });
    return {
      state: "confirmed",
      asOf,
      closesBeforeDate: closesBeforeDate.toString(),
      decision,
      rows: auctions.map((auction) => rowOf(auction, decision)),
    };
  }
}

function rowOf(auction: OpenAuctionRecord, decision: MarketPickDecision): MyBidBoardRowRecord {
  const { baseAmount, floorRate } = auction;
  if (baseAmount === null) return { auction, rule: null, market: null };
  const rule = positionBids({
    baseAmount,
    floorRate,
    participation: auction.bidCount === null ? null : { bidCount: auction.bidCount, observedAt: auction.observedAt },
    deadlineAt: auction.closesAt,
  });
  const result = marketPickFor(decision, { baseAmount, floorRate });
  const spares = result.state === "applicable" && decision.kind === "picked" && floorRate !== null
    ? decision.spares.map((multiple, index): MarketPickPosition => ({
      order: index + 3,
      amount: positionAmount(baseAmount, floorRate, multiple),
      baseRelativeRate: positionBaseRelativeRate(floorRate, multiple),
    }))
    : [];
  return { auction, rule, market: { result, spares } };
}
