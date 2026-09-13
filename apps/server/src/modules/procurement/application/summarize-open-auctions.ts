/** @module 책임: 열린 공고 요약 use case가 기준 시각을 clock에서 한 번 읽어 reader query로 옮기는 경계를 소유한다. */
import { Effect } from "effect";
import type { Clock } from "@eatbid/domain";

import { ProcurementDependencyUnavailable } from "./failures";
import type {
  OpenAuctionSummaryQuery,
  OpenAuctionSummaryReader,
  OpenAuctionSummaryRecord,
} from "./open-auction-summary-reader";

/** HTTP query에서 온 조회 입력이다. 기준 시각은 여기 없고 use case가 clock에서 읽어 옮긴다. */
export interface SummarizeOpenAuctionsInput {
  readonly sidoCodeValueId: bigint | null;
  readonly sigunguCodeValueIds: readonly bigint[] | null;
  readonly eligibilityAreaCodeValueIds: readonly bigint[] | null;
  readonly itemLabel: string | null;
  readonly baseAmountMin: string | null;
  readonly baseAmountMax: string | null;
  readonly calendarFrom: string;
  readonly calendarTo: string;
}

/**
 * presenter가 응답 meta에 기준 시각과 달력 창을 되돌려 실어야 수치가 어느 코호트의 것인지 응답만으로
 * 재현된다(AGENTS 7). 그래서 요약과 함께 reader에 실제로 넘긴 query를 돌려준다.
 */
export interface OpenAuctionSummaryResult {
  readonly query: OpenAuctionSummaryQuery;
  readonly summary: OpenAuctionSummaryRecord;
}

export class SummarizeOpenAuctions {
  constructor(private readonly reader: OpenAuctionSummaryReader, private readonly clock: Clock) {}

  execute(input: SummarizeOpenAuctionsInput): Effect.Effect<
    OpenAuctionSummaryResult,
    ProcurementDependencyUnavailable,
    never
  > {
    // 목록과 같은 규칙이다. 주입된 clock을 요청당 한 번만 읽어 탭·달력·조건 줄이 같은 기준 시각을 쓴다.
    const query: OpenAuctionSummaryQuery = { ...input, asOf: this.clock.now() };
    return Effect.tryPromise({
      try: () => this.reader.summarizeOpen(query),
      catch: (cause) => new ProcurementDependencyUnavailable(cause),
    }).pipe(Effect.map((summary) => ({ query, summary })));
  }
}
