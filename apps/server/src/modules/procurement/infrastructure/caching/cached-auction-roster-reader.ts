/**
 * @module 책임: 회차를 고정해 물은 명단 조회를 프로세스 안에서 (공고, revision) 키로 재사용해 같은 값을
 * 저장소에서 두 번 읽지 않게 하는 port 장식자이며, 그 재사용의 수명과 개수 상한을 소유한다.
 *
 * application이 아니라 infrastructure에 있는 이유: 저장소를 실제로 읽는지는 조회 port의 성질이고 use case는
 * port 인터페이스만 안다. 재시도·시간 제한 같은 다른 장식자도 같은 자리에 둔다(ADR 0045 결정 4).
 */
import { Temporal, minutes, toMilliseconds, type Clock, type ElapsedMilliseconds } from "@eatbid/domain";
import type {
  AuctionRosterQuery,
  AuctionRosterReader,
  AuctionRosterRecord,
} from "../../application/auction-roster-reader";

/**
 * 명단은 개인 자료가 아니라 로그인한 사람이면 같은 값을 받는 공유 사실이므로 프로세스가 한 벌만 들고
 * 모든 요청이 나눠 쓴다. 사용자별 자료를 여기에 넣으면 같은 pod의 다른 사람이 그 답을 받는다.
 *
 * 수명을 두는 이유는 "고정 회차라 불변"이 관측의 성질이 아니라 발행의 성질이기 때문이다. 같은 회차를
 * 다시 관측해 정정하면 값이 바뀔 수 있고, 그 정정이 언제 반영되는지의 상한이 이 값이다. 수집 주기와
 * 같은 15분으로 두어 "한 주기 뒤에는 정정이 보인다"를 지킨다.
 */
const ENTRY_LIFETIME: ElapsedMilliseconds = minutes(15);

/**
 * 상한이 있어야 프로세스 메모리가 열린 회차 수에 비례해 늘지 않는다. 500은 한 pod가 동시에 들고 있어도
 * 되는 명단 수의 상한이며, 넘으면 가장 오래 쓰이지 않은 것부터 버린다. 버린 항목은 다음 조회에서 다시
 * 읽으면 되므로 이 값은 정확성이 아니라 메모리 상한만 정한다.
 */
const MAX_ENTRIES = 500;

interface CachedRoster {
  readonly record: AuctionRosterRecord;
  readonly expiresAt: Temporal.Instant;
}

export class CachedAuctionRosterReader implements AuctionRosterReader {
  readonly #entries = new Map<string, CachedRoster>();

  constructor(
    private readonly source: AuctionRosterReader,
    private readonly clock: Clock,
    private readonly lifetime: ElapsedMilliseconds = ENTRY_LIFETIME,
    private readonly maxEntries: number = MAX_ENTRIES,
  ) {}

  async find(query: AuctionRosterQuery): Promise<AuctionRosterRecord | null> {
    // 회차를 고정하지 않은 조회는 "지금의 최신"을 묻는 것이라 같은 질문이 같은 답을 뜻하지 않는다.
    if (query.revisionId === null) return this.source.find(query);

    const key = `${query.auctionId.toString(10)}:${query.revisionId.toString(10)}`;
    const now = this.clock.now();
    const hit = this.#entries.get(key);
    if (hit !== undefined && Temporal.Instant.compare(hit.expiresAt, now) > 0) {
      // 다시 넣어 사용 순서를 최신으로 만든다. Map은 삽입 순서를 지키므로 이것이 곧 LRU 순서다.
      this.#entries.delete(key);
      this.#entries.set(key, hit);
      return hit.record;
    }

    const record = await this.source.find(query);
    // 아직 발행되지 않은 회차를 "없음"으로 굳히지 않는다. 굳히면 발행 뒤에도 수명이 다할 때까지 없다.
    if (record === null) {
      this.#entries.delete(key);
      return null;
    }
    this.#entries.delete(key);
    this.#entries.set(key, {
      record,
      expiresAt: now.add({ milliseconds: toMilliseconds(this.lifetime) }),
    });
    this.#evictOverflow();
    return record;
  }

  #evictOverflow(): void {
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) return;
      this.#entries.delete(oldest.value);
    }
  }
}
