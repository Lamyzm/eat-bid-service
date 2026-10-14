/**
 * @module 책임: 요청자 워크스페이스의 관심 지역에서 앞으로 30일 안에 마감하는(사실상 열린) 하한율 90·88 공고를 고르고, 공고마다 전국 공식·이번 달 맞춤
 * 금액(두 장·한 장·예비)과 요청하면 아침 갱신 금액을 계산하는 오늘 투찰 use case와 그 내부 record를 소유한다.
 */
import type { AuctionItemAtom } from "@eatbid/contracts";
import { Temporal, type Clock } from "@eatbid/domain";
import { Effect } from "effect";

import type { ResolvedPrincipal } from "../../../platform/auth/principal-reader";
import type { RegionPreferenceRepository } from "../../account/application/region-preference-repository";
import { positionAmount, positionBaseRelativeRate, positionBids, type BidPositionResult } from "../domain/bid-position-rule";
import { KST_TIME_ZONE } from "../domain/kst-month";
import type { MarketPickPosition, MarketPickResult } from "../domain/market-position-pick";
import { boardDisplayEntries, type BidDisplayLedger } from "./bid-display-ledger";
import { marketPickFor, type DecideMarketPick, type MarketPickDecision } from "./decide-market-pick";
import {
  habitCompetitorCount,
  morningHabitPickFor,
  type DecideMorningHabitPick,
  type MorningHabitDecision,
  type MorningHabitPickResult,
} from "./decide-morning-habit-pick";
import { ProcurementDependencyUnavailable } from "./failures";
import type { OpenAuctionReader, OpenAuctionRecord } from "./open-auction-reader";

/** 열린 공고 목록 한 쪽의 상한과 같다. */
const BOARD_PAGE_SIZE = 200;
/**
 * 따라 읽을 쪽 수의 상한이다. 하한율은 목록을 읽은 뒤에 거르므로 다른 하한율 공고도 쪽을 차지한다. 성수기 이틀·넓은 관심 지역이
 * 겹쳐도 넉넉하게 잡고(1,000건), 그래도 남으면 잘렸다고 응답에 싣는다 — 늦게 마감하는 공고가 말없이 빠지면 안 된다.
 */
const BOARD_MAX_PAGES = 5;
/**
 * 마감 창의 길이(KST 날짜 수)다. 사장님은 오늘·내일만이 아니라 열린 공고를 다 보고 미리 준비한다(2026-10-14 사용자). eaT 공고는
 * 게시부터 마감까지 길어야 두세 주라 30일이면 열린 공고 전부이고, 목록 reader의 시간 창 상한(720시간)에도 든다.
 */
const BOARD_WINDOW_DAYS = 30;
/** 이 조각이 다루는 하한율이다. 88은 금액을 화면에 보이지 않지만 공고는 목록에 남긴다(PDR-0008). */
const BOARD_FLOOR_RATES: readonly string[] = ["90.000", "88.000"];

export interface MyBidBoardRowRecord {
  readonly auction: OpenAuctionRecord;
  /** 기초금액이 관측되지 않았으면 null이다. 행을 빼면 공고를 놓친다. */
  readonly rule: BidPositionResult | null;
  readonly market: { readonly result: MarketPickResult; readonly spares: readonly MarketPickPosition[] } | null;
  /** 아침 갱신을 요청하지 않았거나 기초금액이 관측되지 않았으면 null이다. */
  readonly morningHabit: MorningHabitPickResult | null;
}

export type MyBidBoardRecord =
  | { readonly state: "unconfirmed"; readonly asOf: Temporal.Instant }
  | {
    readonly state: "confirmed";
    readonly asOf: Temporal.Instant;
    /** 이 KST 날짜 0시 전에 마감하는 공고만 담았다 — 오늘부터 `BOARD_WINDOW_DAYS`일, 사실상 열린 공고 전부다. */
    readonly closesBeforeDate: string;
    readonly decision: MarketPickDecision;
    /** 요청이 아침 갱신을 고르지 않았으면 null이다. */
    readonly habit: MorningHabitDecision | null;
    readonly rows: readonly MyBidBoardRowRecord[];
    /** 쪽 상한에 닿아 늦게 마감하는 공고 일부를 읽지 못했다. */
    readonly truncated: boolean;
  };

export interface GetMyBidBoardInput {
  readonly principal: ResolvedPrincipal;
  readonly itemAtoms: readonly AuctionItemAtom[] | null;
  readonly includeUnknownItem: boolean;
  readonly includeMorningHabit: boolean;
}

/**
 * 관심 지역은 query가 아니라 저장소에서 읽는다. 화면이 보낸 지역으로 남의 시장을 펼치지 않게 하는 것은 조합 건수 operation과
 * 같은 이유다(PDR-0001). 마감 창은 KST 달력이다 — UTC로 자르면 밤 9시 이후 요청이 하루 밀린다.
 */
export class GetMyBidBoard {
  constructor(
    private readonly reader: OpenAuctionReader,
    private readonly regions: RegionPreferenceRepository,
    private readonly decideMarketPick: DecideMarketPick,
    private readonly decideMorningHabit: DecideMorningHabitPick,
    private readonly clock: Clock,
    private readonly ledger: BidDisplayLedger,
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
    const closesBeforeDate = today.add({ days: BOARD_WINDOW_DAYS });
    const closesBefore = closesBeforeDate.toZonedDateTime(KST_TIME_ZONE).toInstant();
    // 목록 reader는 시간 창만 받는다. 올림한 만큼 넘친 행은 아래에서 날짜 경계로 다시 자른다.
    const hours = Math.min(720, Math.max(1, Math.ceil(asOf.until(closesBefore).total({ unit: "hours" }))));

    const query = {
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
      limit: BOARD_PAGE_SIZE,
    };
    const listed: OpenAuctionRecord[] = [];
    let cursor: bigint | null = null;
    let truncated = false;
    for (let page = 1; ; page += 1) {
      const listing = await this.reader.listOpen({ ...query, cursor });
      if (listing.kind !== "page") {
        // 첫 쪽은 cursor 없이 읽으므로 사라진 cursor가 일어날 수 없다. 일어나면 계약 위반이라 장애로 닫는다.
        if (cursor === null) throw new Error("cursor 없이 보낸 목록 조회가 cursor 오류를 냈다");
        // 다음 쪽을 읽는 사이 목록이 바뀌었다. 읽은 데까지 내고 잘렸다고 말한다.
        truncated = true;
        break;
      }
      listed.push(...listing.page.auctions);
      cursor = listing.page.nextCursor;
      if (cursor === null) break;
      if (page >= BOARD_MAX_PAGES) {
        truncated = true;
        break;
      }
    }

    const auctions = listed.filter((auction) =>
      auction.closesAt !== null
      && Temporal.Instant.compare(auction.closesAt, closesBefore) < 0
      // 하한율 미관측 공고는 남긴다. 하한율은 상세 수집에서만 오므로 그 수집이 밀린 날 행을 빼면 공고가 흔적 없이 사라진다.
      && (auction.floorRate === null || BOARD_FLOOR_RATES.includes(auction.floorRate)));

    // 배수는 공고와 무관해 한 번만 고른다. 하한율이 섞여 있어 하한율을 넘기지 않는다. 두 결정은 서로 기다릴 이유가 없다.
    const workspaceId = input.principal.workspace.workspaceId;
    const [decision, habit] = await Promise.all([
      this.decideMarketPick.decide({ workspaceId }),
      input.includeMorningHabit ? this.decideMorningHabit.decide({ workspaceId }) : Promise.resolve(null),
    ]);
    const record: MyBidBoardRecord = {
      state: "confirmed",
      asOf,
      closesBeforeDate: closesBeforeDate.toString(),
      decision,
      habit,
      rows: auctions.map((auction) => rowOf(auction, decision, habit)),
      truncated,
    };
    // 화면에 내보낸 금액을 장부에 남긴다(ADR 0068). 장부는 던지지 않는다 — 실패해도 이 응답은 그대로 나간다.
    await this.ledger.record({ workspaceId, servedAt: asOf, entries: boardDisplayEntries(record) });
    return record;
  }
}

function rowOf(auction: OpenAuctionRecord, decision: MarketPickDecision, habit: MorningHabitDecision | null): MyBidBoardRowRecord {
  const { baseAmount, floorRate } = auction;
  if (baseAmount === null) return { auction, rule: null, market: null, morningHabit: null };
  const participation = auction.bidCount === null ? null : { bidCount: auction.bidCount, observedAt: auction.observedAt };
  const rule = positionBids({ baseAmount, floorRate, participation, deadlineAt: auction.closesAt });
  const result = marketPickFor(decision, { baseAmount, floorRate });
  const spares = result.state === "applicable" && decision.kind === "picked" && floorRate !== null
    ? decision.spares.map((multiple, index): MarketPickPosition => ({
      order: index + 3,
      amount: positionAmount(baseAmount, floorRate, multiple),
      baseRelativeRate: positionBaseRelativeRate(floorRate, multiple),
    }))
    : [];
  const morningHabit = habit === null ? null : morningHabitPickFor(habit, {
    baseAmount,
    floorRate,
    deadlineAt: auction.closesAt,
    competitorCount: habitCompetitorCount({ floorRate, deadlineAt: auction.closesAt, participation }),
  });
  return { auction, rule, market: { result, spares }, morningHabit };
}
