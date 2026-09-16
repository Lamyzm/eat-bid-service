import { describe, expect, test } from "bun:test";
import { fixedClock, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";
import type { OpenAuctionPage, OpenAuctionQuery } from "./open-auction-reader";

const page: OpenAuctionPage = {
  auctions: [],
  nextCursor: null,
  sampleCount: 0,
  eligibilityMatchedCount: 0,
  eligibilityUnobservedCount: 0,
  snapshotLineage: null,
  orgSummaryLineage: null,
};

const input = {
  regionCodeValueId: null,
  eligibilityAreaCodeValueIds: null,
  itemAtoms: null,
  includeUnknownItem: false,
  searchText: null,
  onlyWithoutBids: false,
  closesWithinHours: null,
  baseAmountMin: null,
  baseAmountMax: null,
  cursor: null,
  limit: 50,
} as const;

// "열림" 기준 시각은 clock에서만 온다. 고정 clock이어야 reader에 넘긴 asOf를 문자 그대로 검사할 수 있다.
const NOW = Temporal.Instant.from("2026-09-07T01:30:00Z");
const clock = fixedClock(NOW);

async function loadUseCase() {
  const application = await import("./list-open-auctions").catch(() => undefined);
  expect(application, "열린 공고 목록 use case가 있어야 한다").toBeDefined();
  return application!;
}

describe("ListOpenAuctions 조회 use case", () => {
  test("clock에서 읽은 기준 시각을 reader query에 넣고 그 query와 페이지를 함께 돌려준다", async () => {
    const { ListOpenAuctions } = await loadUseCase();
    const observed: OpenAuctionQuery[] = [];
    const useCase = new ListOpenAuctions({
      listOpen: async (query) => {
        observed.push(query);
        return { kind: "page", page };
      },
    }, clock);
    const result = await new EffectRunner().run(useCase.execute(input));
    expect(observed).toEqual([{ ...input, asOf: NOW }]);
    // presenter가 meta에 되돌려 실을 값이라 reader에 넘긴 바로 그 query여야 한다(AGENTS 7).
    expect(result.query).toBe(observed[0]!);
    expect(result.page).toBe(page);
  });

  test("cursor가 활성 build에 없으면 VALIDATION_ERROR로 닫는다", async () => {
    const { ListOpenAuctions, OpenAuctionCursorInvalid } = await loadUseCase();
    const useCase = new ListOpenAuctions({
      listOpen: async (query) => ({ kind: "cursor-not-found", cursor: query.cursor ?? 0n }),
    }, clock);
    const failure = await new EffectRunner().run(useCase.execute({ ...input, cursor: 9_007_199_254_740_993n }))
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(OpenAuctionCursorInvalid);
    expect((failure as { code: string }).code).toBe("VALIDATION_ERROR");
  });

  test("reader가 실패하면 DEPENDENCY_UNAVAILABLE로 번역한다", async () => {
    const { ListOpenAuctions } = await loadUseCase();
    const { ProcurementDependencyUnavailable } = await import("./failures");
    const useCase = new ListOpenAuctions({
      listOpen: async () => { throw new Error("database offline"); },
    }, clock);
    const failure = await new EffectRunner().run(useCase.execute(input))
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(ProcurementDependencyUnavailable);
    expect((failure as { code: string }).code).toBe("DEPENDENCY_UNAVAILABLE");
  });
});
