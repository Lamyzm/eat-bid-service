# 오늘 투찰(`/work`) 첫 조각 구현 계획

> **에이전트 작업자:** 필수 하위 skill — superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans로
> 작업 단위마다 구현한다. 단계는 체크박스(`- [ ]`)로 진행을 기록한다.

**목표:** 운영자 계정이 사이드바 `내 투찰 > 오늘 투찰`에서, 관심 지역(참가제한지역)과 고른 품목에 맞는 오늘·내일 마감
하한율 90%·88% 공고를 마감 시각 묶음으로 보고, 공고마다 **이번 달 맞춤**과 **전국 공식**의 1번·2번 금액(복사 버튼)을 나란히
보며, 더 보기에서 한 곳만 넣을 때 금액·예비 3~5순위·방법별 성적을 확인한다.

**설계:** 서버에 `GET /api/v1/me/bid-board`(운영자 전용) operation 하나를 새로 둔다. use case가 관심 지역을 저장소에서 읽어
열린 공고 reader로 "내일 자정 전 마감" 공고를 고르고, 맞춤 배수는 요청당 **한 번만** 고른 뒤(공고와 무관, 워크스페이스·달의
함수) 공고마다 금액으로 바꾼다. 웹은 `/work` route가 이 응답을 표시 모델로 바꿔 U9 틀(오늘 화면)의 행으로 그린다. 아침 갱신 칸은
이 조각에 없다(PDR-0008 결정 5·6 — 결과 전용 수집 줄과 EAT-330 뒤).

**기술:** NestJS + Effect + Drizzle(server), Zod 계약(`packages/contracts`), Next.js 16 App Router + nuqs(web), bun test.

**근거 문서:** [PDR-0008](../../product/decisions/0008-my-bids-market-pick-and-work-screen.md),
[screen-system §10.5](../../product/screen-system.md), 시안 `F:\eatbid-local\design\canvas\W1-Work.dc.html`.

## 전역 제약

- 이 조각은 아침 갱신 칸·상태 표시(`아침에 바뀔 수 있음` 등)를 **만들지 않는다.** 계산이 없는데 표시하면 거짓이다.
- 확률을 응답·화면 어디에도 싣지 않는다(PDR-0008: 모형 확률 1.3배 과신).
- 하한율 88% 행은 금액 없이 `직접 판단`만 단다(PDR-0008 결정 3).
- 맞춤 금액은 하한율 90%에만 낸다. 시장 창 안 공고가 70건 미만이면 내지 않는다(`MARKET_POSITION_PICK.minimumRounds`).
- 최신 개정본은 관측 번호 순이다(EAT-333). 이 조각의 새 SQL은 없지만 시장 SQL을 바꾸면 이 규칙을 지킨다.
- 화면 문구는 `__fixtures__/banned-copy.ts` 규칙과 `tools/architecture/decision-vocabulary/policy.mjs` 금지어(`기대 낙찰`,
  `낙찰 가능성`, `안전 구간` 등)를 지킨다. 성적은 "같은 공고에 대어 본 낙찰 수"라고 쓴다.
- 금액은 문자열(정확한 십진)로만 다루고 웹에서 `Number`로 바꾸지 않는다(AGENTS 15). bigint id는 십진 문자열.
- 새 production 모듈은 `@module 책임:` 한국어 주석, 테스트 제목은 한국어(AGENTS 14·23).
- 커밋 메시지는 한국어 문단 + 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`와 `Claude-Session:` 줄.

## 검토 초점(테스트가 덮지 않으면 사람을 물 다섯 가지)

1. **관심 지역을 아직 확인하지 않은 워크스페이스** — 오늘 화면처럼 목록 대신 "관심 지역을 먼저 정하세요"가 보여야 하고 서버는
   500이 아니라 `regionPreference: "unconfirmed"`로 답한다. → Task 4 테스트.
2. **기초금액이나 하한율이 아직 관측되지 않은 공고** — 행은 남기되 금액 칸은 "기초금액 미확인"/"하한율 미확인"으로 말한다(행을
   조용히 빼면 공고를 놓친다). → Task 4·8 테스트.
3. **맞춤 시장 조회 장애** — 전국 공식 금액은 그대로 나오고 맞춤 칸만 "지금은 계산하지 못했어요". 화면 전체가 오류가 되면 안
   된다. → Task 2·4 테스트.
4. **자정 근처 요청(23:50 KST)** — "오늘·내일"은 KST 달력 기준이라 내일 자정 전까지 마감하는 공고다. UTC로 자르면 하루가 밀린다.
   → Task 4 테스트(고정 clock 2026-10-12T14:50:00Z).
5. **운영자 권한이 없는 계정이 `/work`를 직접 연다** — 사이드바에 항목이 없고, 주소로 열면 "이 화면을 볼 권한이 없어요"가 보인다
   (403을 오류 화면으로 보이지 않는다). → Task 6·8 테스트.

---

### Task 1: 예비 3~5순위 배수를 고르는 도메인 함수

**Files:**
- Modify: `apps/server/src/modules/procurement/domain/market-position-pick.ts`
- Test: `apps/server/src/modules/procurement/domain/market-position-pick.test.ts`

**Interfaces:**
- Produces: `spareMarketMultiples(input: { rounds: readonly MarketRound[]; candidates: CandidateMultiples; distribution: PlannedRatioDistribution; taken: readonly string[]; count: number; minimumGapTenThousandths: number }): readonly string[]`
  — 한 장 기대 낙찰이 높은 순으로, `taken`의 각 배수와 서로 `minimumGapTenThousandths` 이상 떨어진 배수 `count`개(낮은 배수부터가
  아니라 **순위 순**). 동점이면 낮은 배수 먼저.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
describe("예비 순위 배수", () => {
  test("한 장 기대가 큰 순으로 고르되 이미 고른 배수와 서로에게서 0.0005 이상 떨어진 자리만 고른다", () => {
    const rounds = roundsOf(MARKET_PICK_FIXTURE.rounds);
    const taken = [...MARKET_PICK_FIXTURE.expected.twoTickets.multiples, ...MARKET_PICK_FIXTURE.expected.oneTicket.multiples];
    const spares = spareMarketMultiples({
      rounds, candidates: MARKET_POSITION_PICK.candidates, distribution: PLANNED_RATIO_DISTRIBUTION,
      taken, count: 3, minimumGapTenThousandths: 5,
    });
    expect(spares).toHaveLength(3);
    const all = [...taken, ...spares].map((value) => Math.round(Number(value) * 10000));
    for (const spare of spares) {
      const own = Math.round(Number(spare) * 10000);
      expect(all.filter((other) => other !== own).every((other) => Math.abs(other - own) >= 5)).toBe(true);
    }
  });

  test("한 장으로 고른 최선 배수보다 한 장 기대가 큰 예비는 없다", () => {
    const rounds = roundsOf(MARKET_PICK_FIXTURE.rounds);
    const best = pick(rounds, 1);
    const spares = spareMarketMultiples({
      rounds, candidates: MARKET_POSITION_PICK.candidates, distribution: PLANNED_RATIO_DISTRIBUTION,
      taken: best.multiples, count: 3, minimumGapTenThousandths: 5,
    });
    for (const spare of spares) {
      const one = pickMarketMultiples({ rounds, tickets: 1, distribution: PLANNED_RATIO_DISTRIBUTION,
        candidates: { fromTenThousandths: Math.round(Number(spare) * 10000), toTenThousandths: Math.round(Number(spare) * 10000), stepTenThousandths: 1 } });
      expect(one.inSampleExpectedWins).toBeLessThanOrEqual(best.inSampleExpectedWins);
    }
  });

  test("격자가 좁아 조건을 만족하는 자리가 모자라면 있는 만큼만 낸다", () => {
    const spares = spareMarketMultiples({
      rounds: roundsOf([["0.99000000"]]),
      candidates: { fromTenThousandths: 9900, toTenThousandths: 9908, stepTenThousandths: 1 },
      distribution: PLANNED_RATIO_DISTRIBUTION, taken: ["0.9904"], count: 3, minimumGapTenThousandths: 5,
    });
    expect(spares.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `(cd apps/server && bun test src/modules/procurement/domain/market-position-pick.test.ts)`
Expected: FAIL — `spareMarketMultiples` is not exported

- [ ] **Step 3: 구현한다** — `pickMarketMultiples`의 한 장 누적 계산을 내부 함수로 꺼내 둘이 같이 쓴다.

```ts
/** 격자마다 한 장 기대 낙찰 합이다. 두 함수가 같은 적분을 쓰도록 한곳에 둔다. */
function singleTicketScores(rounds: readonly MarketRound[], candidates: CandidateMultiples, distribution: PlannedRatioDistribution) {
  const grid: number[] = [];
  for (let value = candidates.fromTenThousandths; value <= candidates.toTenThousandths; value += candidates.stepTenThousandths) grid.push(value);
  const gridCdf = grid.map((value) => cumulativeAt(distribution, value / 10000));
  const scores = new Float64Array(grid.length);
  for (const round of rounds) {
    const sorted = round.competitorRatios.map(Number).sort((left, right) => left - right);
    let index = 0;
    for (let g = 0; g < grid.length; g += 1) {
      const candidate = grid[g]! / 10000;
      while (index < sorted.length && sorted[index]! < candidate) index += 1;
      const below = index === 0 ? 0 : cumulativeAt(distribution, sorted[index - 1]!);
      scores[g] = scores[g]! + gridCdf[g]! - below;
    }
  }
  return { grid, scores };
}

/**
 * 한 장 기대가 큰 순으로 예비 자리를 고른다. 이미 고른 자리 옆 0.0001 칸은 거의 같은 금액이라 고르는 의미가 없어
 * `minimumGapTenThousandths`만큼 떨어뜨린다. 표본 밖 성적을 잰 적 없는 순위라 화면은 "예비"로만 보인다(PDR-0008).
 */
export function spareMarketMultiples(input: {
  readonly rounds: readonly MarketRound[];
  readonly candidates: CandidateMultiples;
  readonly distribution: PlannedRatioDistribution;
  readonly taken: readonly string[];
  readonly count: number;
  readonly minimumGapTenThousandths: number;
}): readonly string[] {
  const { grid, scores } = singleTicketScores(input.rounds, input.candidates, input.distribution);
  const order = grid.map((_, index) => index).sort((left, right) => scores[right]! - scores[left]! || grid[left]! - grid[right]!);
  const chosen = input.taken.map((multiple) => Math.round(Number(multiple) * 10000));
  const spares: string[] = [];
  for (const index of order) {
    if (spares.length >= input.count) break;
    const value = grid[index]!;
    if (chosen.some((other) => Math.abs(other - value) < input.minimumGapTenThousandths)) continue;
    chosen.push(value);
    spares.push(multipleText(value));
  }
  return spares;
}
```

`pickMarketMultiples`의 한 장 갈래는 `singleTicketScores`를 쓰도록 바꾼다(두 장 갈래의 `own` 계산은 그대로 둔다). 기존 numpy
대조 테스트 둘이 그대로 통과해야 한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `(cd apps/server && bun test src/modules/procurement/domain/market-position-pick.test.ts)`
Expected: 기존 6 + 새 3 PASS

- [ ] **Step 5: 커밋** — `feat(bid-position): 한 장 기대 순으로 예비 맞춤 배수를 고른다 (EAT-327)`

### Task 2: 맞춤 배수 결정을 use case에서 꺼내 목록과 공고 상세가 같이 쓴다

**Files:**
- Create: `apps/server/src/modules/procurement/application/decide-market-pick.ts`
- Create: `apps/server/src/modules/procurement/application/decide-market-pick.test.ts`
- Modify: `apps/server/src/modules/procurement/application/find-auction-bid-position.ts` (private `marketPick`·`unavailable`을 새 클래스 호출로)
- Modify: `apps/server/src/modules/procurement/procurement.module.ts` (provider)

**Interfaces:**
- Consumes: Task 1 `spareMarketMultiples`.
- Produces:
```ts
export type MarketPickDecision =
  | { readonly kind: "picked"; readonly method: MarketPositionPickMethod; readonly window: MarketPickWindow;
      readonly pick: MarketPick; readonly single: MarketPick; readonly spares: readonly string[];
      readonly marketRounds: number; readonly linkedBusinesses: number }
  | { readonly kind: "not-applicable"; readonly method: MarketPositionPickMethod; readonly window: MarketPickWindow;
      readonly reasons: readonly MarketPickNotApplicableReason[]; readonly marketRounds: number | null };
export interface MarketPickWindow { readonly fromMonth: KstMonth; readonly throughMonth: KstMonth; readonly currentMonth: KstMonth }
export class DecideMarketPick {
  constructor(snapshot: UnitOfWork, businesses: RegisteredBusinessReader, marketRounds: MarketRoundReader, clock: Clock);
  /** 하한율 90 시장의 이번 달 배수다. 공고와 무관해서 목록 요청은 한 번만 부른다. 실패는 "market-data-unavailable"로 닫는다. */
  decide(input: { readonly workspaceId: bigint }): Promise<MarketPickDecision>;
}
/** 공고 하나의 금액으로 바꾼다. 하한율이 90이 아니거나 관측되지 않았으면 그 이유로 닫는다. */
export function marketPickFor(decision: MarketPickDecision, auction: { readonly baseAmount: Money; readonly floorRate: BidRate | null }): MarketPickResult;
```

- [ ] **Step 1: 실패하는 테스트를 쓴다** — 기존 `find-auction-bid-position.test.ts`의 다섯 경우를 `DecideMarketPick`/`marketPickFor`로 옮긴 판(사업자 둘·하나·없음, 69건, 조회 실패) + 예비 3개가 나오는지 + 하한율 88이면 `floor-rate-outside-market-pick`.

```ts
test("배수는 한 번 고르고 공고마다 금액만 바꾼다 — 하한율 88 공고는 맞춤 밖이다", async () => {
  const decision = await decideWith({ businesses: [business(101n), business(102n)] });
  if (decision.kind !== "picked") throw new Error("골라야 한다");
  expect(decision.spares).toHaveLength(3);
  const ninety = marketPickFor(decision, { baseAmount: krw(canonicalDecimal("10000000.00", 2)), floorRate: bidRate(canonicalDecimal("90.000", 3)) });
  expect(ninety.state).toBe("applicable");
  const eightyEight = marketPickFor(decision, { baseAmount: krw(canonicalDecimal("10000000.00", 2)), floorRate: bidRate(canonicalDecimal("88.000", 3)) });
  expect(eightyEight).toEqual({ state: "not-applicable", reasons: ["floor-rate-outside-market-pick"], marketRounds: null });
});
```
(`decideWith`은 기존 테스트의 `useCase` 도우미를 `DecideMarketPick` 생성으로 바꾼 것이다. 고정 예제 24건 × 3, `fixedClock("2026-10-12T03:00:00Z")`.)

- [ ] **Step 2:** `bun test .../decide-market-pick.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현** — `find-auction-bid-position.ts`의 `marketPick()`·`unavailable()`·`notApplicable()`·`monthStart()` 본문을
  `DecideMarketPick`으로 옮긴다. 하한율 판정은 `marketPickFor`로 옮기고(결정은 하한율 90 시장 하나라 `decide`는 하한율을 받지 않는다),
  `picked`일 때 `spares = spareMarketMultiples({ rounds, candidates: method.candidates, distribution: PLANNED_RATIO_DISTRIBUTION, taken: [...pick.multiples, ...single.multiples], count: 3, minimumGapTenThousandths: 5 })`.
  `FindAuctionBidPosition` 생성자는 `(reader, decideMarketPick: DecideMarketPick, clock)`로 줄이고 `execute`는
  `decideMarketPick.decide({ workspaceId })` → `marketPickFor(decision, auction)`로 기존 `MarketPickRecord`를 만든다(응답은 그대로).
  module provider: `{ provide: DecideMarketPick, inject: [READ_SNAPSHOT, REGISTERED_BUSINESS_READER, MARKET_ROUND_READER, CLOCK], useFactory: (...) => new DecideMarketPick(...) }`,
  `FindAuctionBidPosition`은 `inject: [AUCTION_READER, DecideMarketPick, CLOCK]`.
- [ ] **Step 4:** `bun test src/modules/procurement src/testing/auction-bid-position.e2e.test.ts` → 전부 PASS(기존 e2e 응답 불변 확인)
- [ ] **Step 5: 커밋** — `refactor(bid-position): 이번 달 맞춤 배수 결정을 공고와 떼어 목록이 한 번만 고르게 한다 (EAT-327)`

### Task 3: `me/bid-board` 공개 계약

**Files:**
- Create: `packages/contracts/src/api/v1/me/bid-board.response.ts`, `bid-board.operations.ts`, `bid-board.test.ts`
- Modify: `packages/contracts/src/api/v1/me/index.ts`, `packages/contracts/src/api/registry.ts`

**Interfaces:**
- Produces: `myBidBoardV1Operations.getMyBidBoard`(GET `/api/v1/me/bid-board`, operationId `getMyBidBoard`), `MyBidBoardV1Response`, `myBidBoardQuerySchema`.

- [ ] **Step 1: 실패하는 테스트**

```ts
describe("오늘 투찰 공개 계약", () => {
  test("공고 행은 전국 공식과 맞춤 금액을 따로 싣고 왕복한다", () => {
    expect(myBidBoardV1ResponseSchema.parse(boardFixture())).toEqual(boardFixture());
  });
  test("관심 지역을 확인하지 않았으면 행 없이 그 사실만 싣는다", () => {
    const unconfirmed = { ...boardFixture(), regionPreference: "unconfirmed", rows: [] };
    expect(myBidBoardV1ResponseSchema.safeParse(unconfirmed).success).toBe(true);
    expect(myBidBoardV1ResponseSchema.safeParse({ ...unconfirmed, rows: boardFixture().rows }).success).toBe(false);
  });
  test("맞춤 칸의 예비 순위는 세 개까지이고 확률 필드를 받지 않는다", () => {
    const row = boardFixture().rows[0]!;
    const four = { ...row, market: { ...row.market, spares: [...(row.market as { spares: unknown[] }).spares, (row.market as { spares: unknown[] }).spares[0]] } };
    expect(myBidBoardV1ResponseSchema.safeParse({ ...boardFixture(), rows: [four] }).success).toBe(false);
  });
  test("bid-board 경로를 operation 하나에서 파생한다", () => {
    expect(myBidBoardV1Operations.getMyBidBoard.buildPath({ path: {} })).toBe("/api/v1/me/bid-board");
    expect(myBidBoardV1Operations.getMyBidBoard.problemResponses[403]).toBeDefined();
  });
});
```

- [ ] **Step 2:** `(cd packages/contracts && bun test src/api/v1/me/bid-board.test.ts)` → FAIL
- [ ] **Step 3: 구현**

`bid-board.response.ts`:
```ts
/** @module 책임: 오늘 투찰 화면 한 장의 공개 응답(관심 지역 상태·창·맞춤 방법·공고 행)을 소유한다. */
import { z } from "zod";
import { kstDateTextSchema } from "../../../atoms/calendar";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { moneyWireSchema } from "../../../values/money";
import { bidRateWireSchema } from "../../../values/rate";
import {
  bidPositionMarketEvidenceSchema,
  bidPositionMarketPickReasonSchema,
  bidPositionMarketPickSchema,
  bidPositionResultSchema,
  bidPositionRuleSchema,
  bidPositionSchema,
} from "../auctions/get-auction-bid-position.response";

const marketPositionSchema = bidPositionSchema.pick({ order: true, amount: true, baseRelativeRate: true });

/**
 * 행마다 맞춤 금액이다. 배수는 요청 하나에 한 번 고른 같은 값이라 여기에는 금액만 싣고, 방법 판·창·근거는 머리
 * (`marketPick`)에 한 번 싣는다. 예비는 표본 밖 성적을 잰 적 없는 순위라 따로 둔다(PDR-0008).
 */
export const bidBoardMarketCellSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("applicable"),
    positions: z.array(marketPositionSchema).min(1).max(2),
    single: marketPositionSchema,
    spares: z.array(marketPositionSchema).max(3),
  }),
  z.strictObject({ state: z.literal("not-applicable"), reasons: z.array(bidPositionMarketPickReasonSchema).min(1).max(5) }),
]).meta({ id: "BidBoardMarketCell" });

export const bidBoardRowSchema = z.strictObject({
  auctionId: positiveBigintTextSchema,
  closesAt: instantTextSchema.nullable(),
  organizationLabel: z.string().min(1).max(200).nullable(),
  title: z.string().min(1).max(500).nullable(),
  itemLabel: z.string().min(1).max(200).nullable(),
  displayBidNo: z.string().min(1).max(64).nullable(),
  baseAmount: moneyWireSchema.nullable(),
  floorRate: bidRateWireSchema.nullable(),
  bidCount: nonNegativeCountSchema.nullable(),
  observedAt: instantTextSchema,
  // 기초금액이 아직 관측되지 않은 공고는 두 방법 모두 금액을 만들 수 없어 null이다. 행을 빼면 공고를 놓치고, 이유 enum에
  // 없는 값을 지어내면 계약이 거짓이 된다 — 화면은 `baseAmount: null`을 보고 "기초금액 미확인"이라고 말한다.
  rule: bidPositionResultSchema.nullable(),
  market: bidBoardMarketCellSchema.nullable(),
}).meta({ id: "BidBoardRow" });

/**
 * 관심 지역을 확인하지 않은 워크스페이스는 행이 없다. 지역 없이 전국 공고를 펼치면 "내 시장"이 아닌 공고에 맞춤 금액이
 * 붙는다(PDR-0001: 지역은 사용자가 정한다).
 */
export const myBidBoardV1ResponseSchema = z.discriminatedUnion("regionPreference", [
  z.strictObject({
    regionPreference: z.literal("confirmed"),
    asOf: instantTextSchema,
    closesBeforeDate: kstDateTextSchema,
    rule: bidPositionRuleSchema,
    // 배수는 요청당 한 번 고르므로 방법 판·창·공고 수·근거를 머리에 한 번 싣는다. 근거는 공고 상세 응답에서는 result 안에
    // 있지만 여기서는 결과와 무관하게 늘 보여야 해 머리로 올린다.
    marketPick: bidPositionMarketPickSchema.omit({ result: true }).safeExtend({
      state: z.enum(["picked", "not-applicable"]),
      reasons: z.array(bidPositionMarketPickReasonSchema).max(5),
      marketRounds: nonNegativeCountSchema.nullable(),
      linkedBusinesses: nonNegativeCountSchema,
      evidence: z.array(bidPositionMarketEvidenceSchema).min(1),
    }),
    rows: z.array(bidBoardRowSchema).max(200),
  }),
  z.strictObject({ regionPreference: z.literal("unconfirmed"), asOf: instantTextSchema, rows: z.array(bidBoardRowSchema).max(0) }),
]).meta({ id: "MyBidBoardV1Response" });

export type MyBidBoardV1Response = z.infer<typeof myBidBoardV1ResponseSchema>;
export type BidBoardRowWire = z.infer<typeof bidBoardRowSchema>;
```
`bidPositionMarketPickSchema.omit({ result: true })`가 남기는 것은 `version`·`windowMonths`·`minimumRounds`·`window`다(같은
auctions bid-position family 안의 조립이라 AGENTS 16의 `omit`/`safeExtend` 허용 범위다).

`bid-board.operations.ts`:
```ts
/** @module 책임: v1 오늘 투찰 한 장 operation의 semantic route·query·상태별 schema를 소유한다. */
import { z } from "zod";
import { problemDetailsSchema, unauthenticatedProblemResponse } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation } from "../../operation";
import { itemsFilterSchema, itemUnknownFilterSchema } from "../auctions/list-open-auctions.query";
import { myBidBoardV1ResponseSchema } from "./bid-board.response";

/** 품목만 받는다. 지역은 저장된 관심 지역을 서버가 읽는다 — 화면이 보낸 지역으로 남의 시장을 펼치지 않게 한다. */
export const myBidBoardQuerySchema = z.strictObject({
  items: itemsFilterSchema.optional(),
  itemUnknown: itemUnknownFilterSchema.optional(),
}).meta({ id: "MyBidBoardQuery" });

export const myBidBoardV1Operations = {
  getMyBidBoard: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "me", segments: ["bid-board"] },
    operationId: "getMyBidBoard",
    implementationOwner: "server",
    summary: "관심 지역의 내일 자정 전 마감 하한율 90·88 공고마다 이번 달 맞춤과 전국 공식 금액을 한 번에 낸다. 운영자 전용.",
    tags: ["내 계정과 조건"],
    pathSchema: z.undefined(),
    querySchema: myBidBoardQuerySchema,
    bodySchema: z.undefined(),
    successResponses: { 200: { description: "오늘 투찰 조회 성공", schema: myBidBoardV1ResponseSchema } },
    problemResponses: {
      400: { description: "query가 유효하지 않음", schema: problemDetailsSchema },
      ...unauthenticatedProblemResponse,
      403: { description: "운영자 권한 없음 또는 계정 초기화 미완료", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스 또는 인증 의존성을 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const myBidBoardV1OperationRegistry = createOperationRegistry([myBidBoardV1Operations.getMyBidBoard] as const);
export type MyBidBoardQuery = z.output<typeof myBidBoardQuerySchema>;
```
`me/index.ts`에 `export * from "./bid-board.operations"; export * from "./bid-board.response";`, `api/registry.ts`에
`...myBidBoardV1OperationRegistry,`(같은 `me` resource라 private 헤더 prefix는 이미 있다는 주석 한 줄).

- [ ] **Step 4:** `(cd packages/contracts && bun test src && npx tsc -p tsconfig.json --noEmit)` → PASS, 그리고 `pnpm contracts:check`
- [ ] **Step 5: 커밋** — `feat(contracts): 오늘 투찰 한 장 operation과 응답을 정의한다 (EAT-327)`

### Task 4: 서버 use case·presenter·controller와 OpenAPI

**Files:**
- Create: `apps/server/src/modules/procurement/application/get-my-bid-board.ts` (+ `.test.ts`)
- Create: `apps/server/src/modules/procurement/presentation/http/my-bid-board.controller.ts`, `my-bid-board.presenter.ts`
- Modify: `procurement.module.ts`, `apps/server/openapi/openapi.json`, `apps/server/src/bootstrap/openapi.test.ts`
- Create: `apps/server/src/testing/my-bid-board.e2e.test.ts`

**Interfaces:**
- Consumes: Task 2 `DecideMarketPick`·`marketPickFor`, `OpenAuctionReader.listOpen`, `RegionPreferenceRepository.readPreference(workspaceId)`, `positionBids`.
- Produces: `GetMyBidBoard.execute({ principal: ResolvedPrincipal; itemAtoms: readonly AuctionItemAtom[] | null; includeUnknownItem: boolean }): Effect<MyBidBoardRecord, ProcurementDependencyUnavailable>`

```ts
export type MyBidBoardRecord =
  | { readonly regionPreference: "unconfirmed"; readonly asOf: Temporal.Instant }
  | { readonly regionPreference: "confirmed"; readonly asOf: Temporal.Instant; readonly closesBeforeDate: string;
      readonly decision: MarketPickDecision; readonly rows: readonly MyBidBoardRowRecord[] };
export interface MyBidBoardRowRecord {
  readonly auction: OpenAuctionRecord;
  /** 기초금액이 관측되지 않았으면 null이다. */
  readonly rule: BidPositionResult | null;
  readonly market: { readonly result: MarketPickResult; readonly spares: readonly MarketPickPosition[] } | null;
}
```

- [ ] **Step 1: 실패하는 use case 테스트**(가짜 reader·저장소·고정 clock)

```ts
test("관심 지역을 확인하지 않았으면 공고를 읽지 않고 unconfirmed로 답한다", ...);   // listOpen 호출 0
test("KST 23:50에 부르면 모레 0시 전 마감까지 고른다 — closesWithinHours는 24시간 10분을 올림한 25시간", async () => {
  // clock 2026-10-12T14:50:00Z = KST 10-12 23:50 → 내일(10-13) 자정 = 2026-10-13T15:00:00Z, 남은 24h10m → 25
  expect(asked[0]!.closesWithinHours).toBe(25);
  expect(asked[0]!.eligibilityAreaCodeValueIds).toEqual([15653n]);
  expect(result.closesBeforeDate).toBe("2026-10-14");
});
test("하한율 90·88 행만 남기고 마감이 내일 자정 뒤인 행을 뺀다", ...);
test("기초금액이 없는 행은 남기되 전국 공식·맞춤 모두 이유로 닫는다", ...);
test("맞춤 시장 조회가 실패해도 전국 공식 금액은 그대로 낸다", ...);
```

- [ ] **Step 2:** `bun test .../get-my-bid-board.test.ts` → FAIL
- [ ] **Step 3: 구현 요점**
  - `asOf = clock.now()` 한 번. `closesBefore = 내일 KST 날짜 + 1일의 KST 0시`(`Temporal.PlainDate`·`KST_TIME_ZONE`, `kst-month.ts`와 같은
    시간대 상수). `closesWithinHours = ceil((closesBefore − asOf) / 1h)`, 1..720로 자른다. 결과 행에서 `closesAt >= closesBefore`인 행은 뺀다(올림으로 넘친 몫).
  - 지역: `RegionPreferenceRepository.readPreference(workspaceId)` → `confirmedAt === null`이면 `unconfirmed`.
    (account의 `REGION_PREFERENCE_REPOSITORY` 토큰은 DatabaseModule이 global export — `countMyFilterCombinations` 선례 주석을 옮긴다.)
  - 목록: `reader.listOpen({ asOf, eligibilityAreaCodeValueIds: areas, itemAtoms, includeUnknownItem, closesWithinHours, limit: 200, 나머지 null/false })`.
  - 행 필터: `floorRate?.value === "90.000" || "88.000"`. 88 행은 `rule`도 계산하되 화면은 금액을 숨긴다(응답은 정직하게 싣는다).
  - 맞춤: `decision = await decideMarketPick.decide({ workspaceId })`(한 번), 행마다 `marketPickFor(decision, row)`; `picked`이면
    예비 금액을 `positionAmount(base, floor, spare)`·`positionBaseRelativeRate(floor, spare)`로 만든다.
  - 기초금액이 `null`인 행: `positionBids`·`marketPickFor`를 부르지 않고 `rule: null`, `market: null`로 둔다(Task 3 스키마 주석).
  - 참여 수: `positionBids`의 `participation`은 행의 `{ bidCount, observedAt }`(bidCount가 null이면 `null`), `deadlineAt`은 `closesAt`.
  - presenter는 `auction-bid-position.presenter.ts`의 `marketPositionWire`·`ruleWire` 함수를 재사용(필요하면 export).
  - controller: `@UseGuards(OperatorGuard)`, `@Controller({ path: operation.controllerPath, version })`, `@Get(operation.handlerPath)`,
    `@ResponseSchema(...)`, `@CurrentPrincipal() principal`, query는 `StandardSchemaPipe(operation.querySchema)`.
  - module: provider `GetMyBidBoard`(inject `OPEN_AUCTION_READER, REGION_PREFERENCE_REPOSITORY, DecideMarketPick, CLOCK`), controller 등록.
  - OpenAPI: `pnpm --filter @eatbid/server openapi:generate`, `bootstrap/openapi.test.ts`의 경로 목록에 `/api/v1/me/bid-board`, operationId 목록에 `getMyBidBoard` 추가.
- [ ] **Step 4: e2e**(`auction-bid-position.e2e.test.ts` 패턴): 운영자 200·비운영자 403·권한 조회 장애 503, 응답이 계약을 통과.
  Run: `(cd apps/server && bun test src/modules/procurement src/testing/my-bid-board.e2e.test.ts src/bootstrap/openapi.test.ts)` → PASS
- [ ] **Step 5: 커밋** — `feat(bid-board): 관심 지역의 오늘·내일 마감 공고마다 맞춤·전국 공식 금액을 한 번에 낸다 (EAT-327)`

### Task 5: 세션에 운영자 여부를 싣는다

**Files:**
- Modify: `packages/contracts/src/api/v1/session/get-current-session.response.ts` (active에 `operator: z.boolean()`)
- Modify: `apps/server/src/modules/account/application/get-current-session.ts` (grant reader 주입, active 기록에 `operator`)
- Modify: `apps/server/src/modules/account/account.module.ts` (inject에 `AUTH_TOKENS.operatorGrantReader`)
- Modify: `apps/server/src/modules/account/presentation/http/account.presenter.ts`
- Modify fixtures: `apps/web/e2e/support/session-fixture.ts`, `apps/web/src/capabilities/account/use-account-session.test.tsx`,
  `apps/web/src/app/(workspace)/_model/session-gate.test.ts`, `apps/web/src/app/(auth)/setup/_ui/setup-screen.test.tsx`,
  `packages/contracts/src/api/v1/session/operations.test.ts`, `apps/server/src/modules/account/presentation/http/account.presenter.test.ts`

- [ ] **Step 1:** presenter·use case 테스트에 "운영자 권한이 있는 활성 세션은 operator: true", "권한 조회 장애는 503"(세션 전체가 아니라 —
  아래 결정 참고) 추가 → FAIL
- [ ] **Step 2:** 결정 — 권한 조회가 실패하면 세션을 503으로 만들지 않고 `operator: false`로 답한다. 세션은 모든 화면의 게이트라
  권한 장애로 전체가 막히면 안 되고, 오늘 투찰 operation 자체는 `OperatorGuard`가 503으로 따로 지킨다. 이 이유를 use case 주석에 쓴다.
- [ ] **Step 3:** 구현·fixture 갱신, `pnpm contracts:check`, `pnpm --filter @eatbid/server openapi:generate`(세션 스키마 변경)
- [ ] **Step 4:** `(cd apps/server && bun test src/modules/account) && (cd packages/contracts && bun test src) && (cd apps/web && bun test src)` → PASS
- [ ] **Step 5: 커밋** — `feat(session): 활성 세션에 운영자 여부를 싣는다 (EAT-327)`

### Task 6: 웹 API 자원

**Files:**
- Create: `apps/web/src/api/me/get-my-bid-board.ts` (+ `.test.ts`), Modify: `apps/web/src/api/me/server.ts`(없으면 `api/account/server.ts` 관례를 따라 만든다)
- Modify(필요 시): `packages/contracts/package.json` exports·`tools/architecture/check-contract-client-exports.mjs`(웹이 `@eatbid/contracts/api/v1/me` subpath를 이미 쓰는지 먼저 확인 — 쓰고 있으면 손대지 않는다)

**Interfaces:**
- Produces: `type MyBidBoardRead = { kind: 'board'; response: MyBidBoardV1Response } | { kind: 'forbidden' }`,
  `getMyBidBoardWith(request, { items?: readonly string[]; itemUnknown?: 'include'; signal? })`, `getMyBidBoardFromServer(input)`(privateServerRequest, `use cache` 없음).

- [ ] **Step 1:** 테스트 — 403은 `{ kind: 'forbidden' }`, 그 밖의 Problem은 던진다, query는 `myBidBoardQuerySchema.parse`를 거친다.
- [ ] **Step 2~4:** `get-auction-bid-position.ts`와 같은 모양으로 구현, `(cd apps/web && bun test src/api/me)` PASS
- [ ] **Step 5: 커밋** — `feat(web): 오늘 투찰 한 장을 검증된 transport로 읽는다 (EAT-327)`

### Task 7: 복사 손잡이를 shared로 올린다

**Files:**
- Create: `apps/web/src/shared/ui/copy-value.tsx` (+ `.test.tsx`)
- Modify: `apps/web/src/app/(workspace)/today/_ui/copy-bid-no.tsx` → `CopyValue`를 쓰는 얇은 감싸개로(공고번호 문구는 유지)

**Interfaces:**
- Produces: `CopyValue({ value: string; label: string; children: ReactNode })` — 누르면 `navigator.clipboard.writeText(value)`, 낭독기
  이름 `${label} 복사`, 성공 시 `role='status'` "복사됨", 실패는 조용히(값은 화면에 있다).

- [ ] **Step 1~4:** 테스트(눌렀을 때 writeText 호출·"복사됨" 표시·실패 시 표시 없음) → 구현 → `(cd apps/web && bun test src/shared/ui src/app/(workspace)/today)` PASS
- [ ] **Step 5: 커밋** — `refactor(web): 복사 손잡이를 두 화면이 같이 쓰도록 shared로 올린다 (EAT-327)`

### Task 8: `/work` route와 표시 모델

**Files (ADR 0044 배치):**
- Create: `apps/web/src/app/(workspace)/work/page.tsx`, `loading.tsx`, `error.tsx`
- Create: `.../work/_lib/work-search-params.ts`(nuqs: `items`, `itemUnknown`), `.../work/_lib/load-work-page.ts`(+ `.test.ts`)
- Create: `.../work/_features/bid-board/model/present-bid-board.ts`(+ `.test.ts`), `.../model/group-closing-times.ts`(+ `.test.ts`)
- Create: `.../work/_features/bid-board/ui/bid-board-list.tsx`, `bid-board-row.tsx`, `item-chips.tsx`
- Create: `.../work/_widgets/work-screen.tsx`, `work-screen-skeleton.tsx`, `work-frame.tsx`
- Create: `.../work/__fixtures__/bid-board.ts`(2026-09-22 김해 육류 실제 공고 10건 모양)

**Interfaces:**
- Consumes: Task 6 `getMyBidBoardFromServer`, Task 7 `CopyValue`.
- Produces(표시 모델):
```ts
export type BidBoardView =
  | { kind: 'forbidden' } | { kind: 'failed' } | { kind: 'region-unconfirmed' }
  | { kind: 'board'; title: string; lede: string; stamp: string; columns: readonly ColumnHead[]; groups: readonly ClosingGroup[] };
export interface ColumnHead { readonly label: '이번 달 맞춤' | '전국 공식'; readonly record: string } // 예: "95.0건 / 1,838건"
export interface ClosingGroup { readonly label: string; readonly relative: string; readonly rows: readonly BidBoardRowView[] }
export interface BidBoardRowView {
  readonly auctionHref: Route; readonly organization: string; readonly item: string; readonly title: string;
  readonly facts: string; // "기초금액 12,261,430원 · 참여 71곳"
  readonly selfJudged: boolean; // 하한율 88
  readonly cells: readonly AmountCell[]; // [맞춤, 전국 공식] 순서 고정
  readonly more: { single: AmountLine | null; spares: readonly AmountLine[]; band: string | null };
}
export type AmountCell =
  | { kind: 'amounts'; lead: boolean; lines: readonly AmountLine[] }   // 1번·2번
  | { kind: 'reason'; text: string };                                  // "기초금액 미확인" 등
export interface AmountLine { readonly label: string; readonly amount: string; readonly copyValue: string } // amount "10,868,655원", copyValue "10868655"
```

- [ ] **Step 1: 표시 모델 테스트(한국어 제목)**
```ts
test('공고를 KST 마감 시각으로 묶고 마감 순으로 세운다', ...);           // 09:00 / 10:00 / 15:10, 내일 묶음은 "내일 · " 머리
test('맞춤이 나온 행은 맞춤 칸에 근거 표시를 두고 전국 공식은 옆에 그대로 둔다', ...);
test('하한율 88 행은 금액 없이 직접 판단으로 표시한다', ...);
test('기초금액이 없는 행은 두 칸 모두 기초금액 미확인이라고 말한다', ...);
test('맞춤 시장 조회가 실패하면 맞춤 칸만 지금은 계산하지 못했다고 말하고 전국 공식 금액은 남긴다', ...);
test('복사값은 원 단위 숫자만이고 화면 금액은 쉼표와 원을 붙인다', ...);
test('화면 문구는 금지 문형과 결정 어휘 금지어를 쓰지 않는다', () => {
  for (const view of allFixtureViews()) expect(findBannedCopy(JSON.stringify(view))).toEqual([]);
});
```
- [ ] **Step 2:** `(cd apps/web && bun test "src/app/(workspace)/work")` → FAIL
- [ ] **Step 3: 구현** — 표시 모델은 문자열 산술만(`present-market-pick.ts`의 `wonText`·`decimalSum` 방식; 같은 코드가 두 곳이면
  `duplicate-source-group`에 걸리므로 `apps/web/src/shared/lib/won-text.ts`로 올리고 두 곳이 import). 행 UI는 시안 W1의 구조(왼쪽 세 줄,
  오른쪽 두 칸 184px, 근거 칸 테두리, 더 보기). `page.tsx`는 Suspense 안 loader, `loading.tsx`는 `WorkScreenSkeleton` 하나만 반환.
  `forbidden` → "이 화면을 볼 권한이 없어요.", `region-unconfirmed` → "관심 지역을 먼저 정하세요"와 `/setup` 링크.
- [ ] **Step 4:** `(cd apps/web && bun test "src/app/(workspace)/work" && pnpm typecheck && npx oxlint --deny-warnings "src/app/(workspace)/work" src/shared) && pnpm lint:web-boundaries` → PASS
- [ ] **Step 5: 커밋** — `feat(web): 오늘 투찰 화면에 공고마다 맞춤·전국 공식 금액을 나란히 보인다 (EAT-327)`

### Task 9: 사이드바 `내 투찰`과 로그인 복귀

**Files:**
- Modify: `apps/web/src/shell/layout/app-sidebar.tsx`(`extraNav?: ReactNode` slot을 기본 묶음 뒤에), `nav-config.ts`(타입 export만),
  Create: `apps/web/src/shell/layout/nav-group-menu.tsx`(묶음 하나를 활성 표시와 함께 그리는 client leaf — `SidebarNavGroups`의 한 묶음 렌더를 옮겨 둘이 같이 쓴다)
- Modify: `apps/web/src/shell/layout/application-shell.tsx`(`sidebarExtraNav` 전달), `apps/web/src/app/(workspace)/layout.tsx`
  (Suspense 안 `OperatorNavSlot`: `getCurrentSessionFromServer()`가 active·`operator: true`일 때만 `내 투찰 > 오늘 투찰 /work`)
- Modify: `apps/web/src/shell/auth/return-path.ts`(`REDIRECT_TARGETS`에 `'/work'`) + `return-path.test.ts`

- [ ] **Step 1~4:** 테스트 — 운영자 세션이면 `오늘 투찰` 링크가 보이고 아니면 없다(`OperatorNavSlot` 단위), 로그인 뒤 `/work` 복귀 허용.
  `(cd apps/web && bun test src/shell "src/app/(workspace)/_model" && pnpm typecheck)` PASS
- [ ] **Step 5: 커밋** — `feat(web): 운영자에게만 사이드바 내 투찰 묶음을 보인다 (EAT-327)`

### Task 10: 전체 검증·실제 화면 대조·PR

- [ ] `pnpm architecture:check`, `pnpm test:quality`, `pnpm contracts:check`, `pnpm contracts:python:check`, `pnpm test`(전체) — 모두 통과
- [ ] `pnpm --filter @eatbid/web build`
- [ ] 개발 DB(`pnpm dev:db reset`) + 화면 대조용 합성 시장(`scratchpad/dev_market_seed.sql` 방식: 7~9월 하한율 90 회차 90건, 운영자 권한)
  + 열린 공고(표본 991xxx 중 하한율 90·88, 내일 자정 전 마감) → `pnpm dev:local` → 1280·1440px 밝은·어두운 테마 스크린샷
- [ ] 판정자 subagent(이름 없이)에게 시안 `W1-Work.dc.html`(당일 아침 상태는 아침 갱신 칸이 없는 이 조각과 다르다는 **의도된 차이**를
  미리 적어) 대조를 맡기고 "통과"를 받는다
- [ ] PR(`gh pr create`, 제목·본문 한국어, 검증 결과 그대로) → 자동 병합. 배포는 사용자 확인 뒤(마이그레이션 없음).

## 열린 결정(이 계획 밖)

- **복기용 "그때 보인 금액" 기록:** 화면 조회(GET)가 기록을 쓰면 안전한 조회가 상태를 바꾼다. 저장 위치(app 사용자 기록 vs 정해진 시각에
  배치로 남기는 파생 기록)와 쓰는 주체(사용자 행동 "이 금액 봤음" vs 예약 작업)는 ADR이 필요하다. 복기 계획(EAT-328) 전에 정한다.
- **품목 기본값 기억:** 이 조각은 URL(`items`)이 권위다. 아빠가 매번 고르지 않게 하는 방법(저장 조합 연결 vs 브라우저 기억)은 첫 사용
  뒤 정한다.
