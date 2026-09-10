import { describe, expect, test } from "bun:test";
import { Temporal, minutes, type Clock } from "@eatbid/domain";
import { CachedAuctionRosterReader } from "./cached-auction-roster-reader";
import type {
  AuctionRosterQuery,
  AuctionRosterReader,
  AuctionRosterRecord,
} from "../../application/auction-roster-reader";
import { auctionId } from "../../domain/auction-id";

/** 조회를 세는 대역이다. "저장소를 다시 읽었는가"가 추론이 아니라 관측이 되어야 한다. */
function countingReader(): AuctionRosterReader & {
  readonly calls: readonly AuctionRosterQuery[];
  missing: boolean;
} {
  const calls: AuctionRosterQuery[] = [];
  return {
    calls,
    missing: false,
    async find(query) {
      calls.push(query);
      if (this.missing) return null;
      return { auctionId: query.auctionId, revisionId: query.revisionId ?? 0n } as AuctionRosterRecord;
    },
  };
}

function movingClock(start: string): Clock & { advance(elapsed: number): void } {
  let instant = Temporal.Instant.from(start);
  return {
    now: () => instant,
    advance(elapsed) {
      instant = instant.add({ milliseconds: elapsed });
    },
  };
}

const AUCTION = auctionId(5_796_468n);
const OTHER_AUCTION = auctionId(5_780_681n);
const REVISION = 5_796_469n;

describe("회차를 고정한 명단 조회의 재사용", () => {
  test("같은 공고와 회차를 두 번 열면 저장소를 한 번만 읽는다", async () => {
    const source = countingReader();
    const reader = new CachedAuctionRosterReader(source, movingClock("2026-09-10T00:00:00Z"));

    const first = await reader.find({ auctionId: AUCTION, revisionId: REVISION });
    const second = await reader.find({ auctionId: AUCTION, revisionId: REVISION });

    expect(source.calls.length).toBe(1);
    expect(second).toBe(first!);
  });

  test("공고가 같아도 회차가 다르면 각각 읽는다", async () => {
    const source = countingReader();
    const reader = new CachedAuctionRosterReader(source, movingClock("2026-09-10T00:00:00Z"));

    await reader.find({ auctionId: AUCTION, revisionId: REVISION });
    await reader.find({ auctionId: AUCTION, revisionId: REVISION + 1n });
    await reader.find({ auctionId: OTHER_AUCTION, revisionId: REVISION });

    expect(source.calls.length).toBe(3);
  });

  test("회차를 고정하지 않은 조회는 최신을 묻는 것이라 재사용하지 않는다", async () => {
    const source = countingReader();
    const reader = new CachedAuctionRosterReader(source, movingClock("2026-09-10T00:00:00Z"));

    await reader.find({ auctionId: AUCTION, revisionId: null });
    await reader.find({ auctionId: AUCTION, revisionId: null });

    expect(source.calls.length).toBe(2);
  });

  test("수명이 지나면 정정을 볼 수 있도록 다시 읽는다", async () => {
    const source = countingReader();
    const clock = movingClock("2026-09-10T00:00:00Z");
    const reader = new CachedAuctionRosterReader(source, clock);

    await reader.find({ auctionId: AUCTION, revisionId: REVISION });
    clock.advance(minutes(15));
    await reader.find({ auctionId: AUCTION, revisionId: REVISION });

    expect(source.calls.length).toBe(2);
  });

  test("아직 없는 회차를 없음으로 굳히지 않는다", async () => {
    const source = countingReader();
    const reader = new CachedAuctionRosterReader(source, movingClock("2026-09-10T00:00:00Z"));

    source.missing = true;
    expect(await reader.find({ auctionId: AUCTION, revisionId: REVISION })).toBeNull();
    source.missing = false;
    expect(await reader.find({ auctionId: AUCTION, revisionId: REVISION })).not.toBeNull();

    expect(source.calls.length).toBe(2);
  });

  test("상한을 넘으면 가장 오래 쓰이지 않은 항목부터 버린다", async () => {
    const source = countingReader();
    const reader = new CachedAuctionRosterReader(
      source,
      movingClock("2026-09-10T00:00:00Z"),
      minutes(15),
      2,
    );

    await reader.find({ auctionId: AUCTION, revisionId: 1n });
    await reader.find({ auctionId: AUCTION, revisionId: 2n });
    // 첫 항목을 다시 써서 사용 순서를 최신으로 만든다. 그러면 다음에 밀려나는 것은 둘째다.
    await reader.find({ auctionId: AUCTION, revisionId: 1n });
    await reader.find({ auctionId: AUCTION, revisionId: 3n });

    await reader.find({ auctionId: AUCTION, revisionId: 1n });
    expect(source.calls.length).toBe(3);

    await reader.find({ auctionId: AUCTION, revisionId: 2n });
    expect(source.calls.length).toBe(4);
  });
});
