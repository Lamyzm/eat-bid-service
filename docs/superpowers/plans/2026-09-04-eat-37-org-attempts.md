# EAT-37 기관 회차 이력 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `listOrganizationAuctionAttempts` 계약을 contracts → mart 테이블 → Nest → web 순서로 잇고, 결정 화면의 흐름 차트·과거 회차 표·레일 "이 값이면"을 실데이터 모양의 fixture로 채운다.

**Architecture:** 공개 계약은 `packages/contracts` operation 하나가 소유한다. 서버는 `mart.org_round_summary`(회차 1행 요약)만 읽는 port/adapter를 두고 raw SQL로 cursor 페이지를 낸다. web은 RSC가 계약 응답을 받아 흐름 SVG와 TanStack Table headless 표를 그리고, 레일 "이 값이면"은 같은 응답을 브라우저에서 비교한다(엔드포인트 없음). 투찰률 draft는 client context 하나가 소유해 레일과 표의 파란 열이 같은 값을 본다.

**Tech Stack:** Zod 4(`defineOperation`), Drizzle(pgSchema `mart`), Nest 12 + Effect, Next 16 RSC + nuqs/server, `@tanstack/react-table` headless, inline SVG, bun:test, Playwright, Chrome DevTools MCP(시각 검증은 main agent가 수행).

**Spec:** `docs/product/decision-screen-v2/pages-endpoints-load.md` §1(결정 화면 표의 "흐름 + 과거 회차", "레일 이 값이면" 행), ADR 0031, Linear EAT-37, 디자인 생성기 `docs/product/decision-screen-v2/design-generators/gen_merged.py`의 `mid_history()`·`rehearsal()`·`rail()`.

## Global Constraints

- 문자열을 정체성으로 쓰지 않는다. 기관·회차·품목·업체는 decimal string bigint id로만 wire에 싣는다(AGENTS 2, ADR 0018). 품목 라벨은 표시용이다.
- 시간은 `instantTextSchema`/`Temporal.Instant`, 금액은 `moneyWireSchema`/`Money`, 비율은 `percentagePointsWireSchema`(단위 `percentage-points`)로만 넘긴다. `Date`·plain `number` 비율 금지(AGENTS 15). `Temporal.Now`는 `systemClock`만(AGENTS 17). PostgreSQL driver `Date | string`은 adapter의 `postgresInstant`만.
- 계약은 atom → value → resource → operation 순서로 조립하고 다른 family를 `pick`하지 않는다(AGENTS 16). 새 operation은 `publicHttpOperationRegistry`에 등록한다. Server/Web에 `/api/v1/...` literal을 쓰지 않는다(AGENTS 19).
- 추천가·안전구간·승률 문구 금지(AGENTS 8). "이 값이면"은 과거형 사실 문구("지난 N회 중 낙찰됐을 회차", "그날 하한보다 낮아 무효였을 회차")만 쓴다.
- 모든 집계 응답과 화면에 표본 수·기간·mart release·산출 시각·계산 버전을 남긴다(AGENTS 7).
- 그날 하한(`dayFloorRate`)은 원본 판정이 권위다. 우리 계산으로 덮지 않는다. null이면 화면은 `—`.
- 품목이 다르면 같은 선으로 잇지 않는다. 선은 선택 품목(URL `item`) 회차만, 다른 품목은 속 빈 점.
- 색은 상태에만: 파랑 = 내 값·행동, 빨강 = 그날 하한·무효. 글자 15px 기본, 13px는 단위 꼬리만, `tabular-nums`. nowrap 글자가 밀리거나 잘리면 실패.
- 테스트 제목은 한글 음절 포함. 새 production 모듈은 첫 줄에 `@module 책임:` 주석(AGENTS 23). 판단 경계에는 한국어 why 주석(AGENTS 13).
- 300줄 넘는 파일은 책임 분리를 검토한다(AGENTS 18).
- 커밋 메시지는 한국어. 커밋 본문 마지막 블록에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`과 `Claude-Session: https://claude.ai/code/session_01JCsr2N2vuZVbre9agy38J9`를 한 블록으로 둔다(사이에 빈 줄 없음).
- 실행 명령은 worktree 루트 `F:\Project\eat-bid-service\.claude\worktrees\eat-37-org-attempts`에서 단일 명령으로 실행한다. `cd`·`git -C`·파이프로 git을 감싸지 않는다.
- 서브에이전트는 하위 에이전트를 만들지 않는다. 브라우저(Chrome MCP) 시각 검증은 main agent만 한다.

---

## 파일 구조

| 경로 | 책임 |
| -- | -- |
| `packages/contracts/src/atoms/count.ts` | 음이 아닌 정수 개수 atom |
| `packages/contracts/src/resources/procurement/organization.ts` | 공고의 구매기관 resource |
| `packages/contracts/src/api/v1/auctions/resource.ts` | `organization` 필드 추가 |
| `packages/contracts/src/api/v1/organizations/attempt.resource.ts` | 회차 요약 resource + meta |
| `packages/contracts/src/api/v1/organizations/list-auction-attempts.response.ts` | 응답 schema |
| `packages/contracts/src/api/v1/organizations/operations.ts` | `listOrganizationAuctionAttempts` operation |
| `packages/contracts/src/api/v1/organizations/index.ts` | browser-safe 진입점 |
| `packages/contracts/src/api/registry.ts`, `src/index.ts`, `package.json` exports, `tools/architecture/check-contract-client-exports.mjs` | 등록 |
| `packages/db/src/schema/mart/round-summary.ts`, `mart/index.ts`, `schema/index.ts`, `drizzle/<ts>_mart_org_round_summary/*`, `src/version.ts` | mart 테이블·마이그레이션 |
| `apps/server/src/modules/procurement/domain/organization-id.ts` | 기관 id 값 |
| `apps/server/src/modules/procurement/application/organization-attempt-reader.ts` | port + record |
| `apps/server/src/modules/procurement/application/list-organization-auction-attempts.ts` | use case + 응답 변환 |
| `apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-organization-attempt-reader.ts` | adapter |
| `apps/server/src/modules/procurement/presentation/http/organization.controller.ts` | HTTP |
| `apps/server/src/modules/procurement/application/auction-reader.ts`, `find-auction.ts`, `infrastructure/drizzle/drizzle-auction-reader.ts` | 공고 응답에 organization 추가 |
| `apps/server/src/platform/database/database.tokens.ts`, `database.module.ts`, `apps/server/src/app.module.ts`, `modules/procurement/procurement.module.ts` | 조립 |
| `apps/server/openapi/openapi.json` | 재생성 |
| `apps/web/src/api/organizations/{list-auction-attempts.ts,organization-resource-error.ts,queries.ts,server.ts,index.ts}` | web 소비자 |
| `apps/web/src/app/(workspace)/auctions/[auctionId]/_lib/decision-search-params.ts` | `item` param |
| `.../_model/attempt-history.ts` | 응답 → 표시 행 |
| `.../_model/rehearsal.ts` | "이 값이면" 순수 계산 |
| `.../_model/load-auction-page.ts` | 회차 이력 병행 조회 |
| `.../_ui/bid-rate-context.tsx` | 투찰률 draft client context |
| `.../_ui/flow-chart.tsx` | 흐름 SVG |
| `.../_ui/history-table.tsx` | 과거 회차 표(TanStack headless) |
| `.../_ui/rehearsal-panel.tsx` | 레일 "이 값이면" 묶음 |
| `.../_ui/bid-rail.tsx`, `decision-screen.tsx`, `page.tsx` | 조립 |
| `.../__fixtures__/attempts.ts` | 회차 fixture |
| `apps/web/e2e/support/fixtures/namsan-attempts.json`, `apps/web/e2e/support/auction-contract-fixture-server.ts`, `apps/web/e2e/decision-screen.spec.ts` | e2e |

---

### Task 1: 계약 — 기관 회차 이력 operation과 공고 organization 필드

**Files:**
- Create: `packages/contracts/src/atoms/count.ts`
- Create: `packages/contracts/src/resources/procurement/organization.ts`
- Modify: `packages/contracts/src/api/v1/auctions/resource.ts`
- Create: `packages/contracts/src/api/v1/organizations/attempt.resource.ts`
- Create: `packages/contracts/src/api/v1/organizations/list-auction-attempts.response.ts`
- Create: `packages/contracts/src/api/v1/organizations/operations.ts`
- Create: `packages/contracts/src/api/v1/organizations/index.ts`
- Modify: `packages/contracts/src/api/registry.ts`, `packages/contracts/src/index.ts`, `packages/contracts/package.json`
- Modify: `tools/architecture/check-contract-client-exports.mjs` (`clientExports`에 `["./api/v1/organizations", "./src/api/v1/organizations/index.ts"]` 추가)
- Test: `packages/contracts/src/api/v1/organizations/operations.test.ts`, `packages/contracts/src/api/v1/auctions/get-auction.response.test.ts`(기존 fixture에 `organization` 추가), `packages/contracts/src/contracts.test.ts`(registry 개수/ID 갱신)

**Interfaces:**
- Produces: `organizationV1Operations.listAuctionAttempts` (`operationId: "listOrganizationAuctionAttempts"`, GET `/api/v1/organizations/{organizationId}/auction-attempts`, query `{ item?, cursor?, limit }`), `organizationAuctionAttemptsV1ResponseSchema`, `OrganizationAuctionAttemptsV1Response`, `OrganizationAuctionAttempt`, `auctionOrganizationSchema`. `AuctionV1Response`에 `organization: { organizationId, name, type } | null` 추가.

- [ ] **Step 1: 실패하는 테스트 작성** — `operations.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { organizationV1Operations } from "./operations";
import { organizationAuctionAttemptsV1ResponseSchema } from "./list-auction-attempts.response";

describe("listOrganizationAuctionAttempts 계약", () => {
  test("경로와 query를 canonical 형태로 조립한다", () => {
    const path = organizationV1Operations.listAuctionAttempts.buildPath({
      path: { organizationId: "42" },
      query: { limit: 60, cursor: "5796468", item: "7" },
    });
    expect(path).toBe("/api/v1/organizations/42/auction-attempts?cursor=5796468&item=7&limit=60");
  });

  test("limit 기본값은 12이고 200을 넘으면 거부한다", () => {
    const { querySchema } = organizationV1Operations.listAuctionAttempts;
    expect(querySchema.parse({})).toEqual({ limit: 12 });
    expect(querySchema.parse({ limit: "200" })).toEqual({ limit: 200 });
    expect(() => querySchema.parse({ limit: "201" })).toThrow();
  });

  test("빈 이력 응답도 meta의 표본 수와 release를 요구한다", () => {
    const parsed = organizationAuctionAttemptsV1ResponseSchema.parse({
      organizationId: "42",
      attempts: [],
      nextCursor: null,
      meta: { sampleCount: 0, martRelease: null, computedAt: null, calcVersion: null },
    });
    expect(parsed.attempts).toHaveLength(0);
  });

  test("회차 행은 비율 단위와 금액 통화를 강제한다", () => {
    const row = {
      attemptId: "5796468", announcedAt: "2026-09-01T00:00:00Z", openedAt: "2026-09-04T05:00:00Z",
      item: { codeValueId: "7", label: "축산" },
      floorRate: { value: "90.000", unit: "percentage-points" },
      baseAmount: { amount: "2761700.00", currency: "KRW" },
      winRate: { value: "90.309", unit: "percentage-points" },
      secondRate: null, dayFloorRate: null, listCount: 17, invalidCount: 2,
      winnerSupplierPartyId: "9", supersedesAttemptId: null,
    };
    expect(organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element.parse(row)).toEqual(row);
    expect(() => organizationAuctionAttemptsV1ResponseSchema.shape.attempts.element.parse({ ...row, winRate: 90.309 })).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @eatbid/contracts test` → `operations` 모듈 없음으로 실패.

- [ ] **Step 3: 구현**

`atoms/count.ts`:
```ts
import { z } from "zod";

// 개수는 wire에서 JSON 정수다. 비율·금액과 달리 단위 봉투가 없으므로 이름으로 목적을 드러낸다.
export const nonNegativeCountSchema = z.number().int().nonnegative().max(2_147_483_647).meta({
  id: "NonNegativeCount",
  description: "Count of observed rows; JSON integer within PostgreSQL integer range.",
});
```

`resources/procurement/organization.ts`:
```ts
import { z } from "zod";
import { positiveBigintTextSchema } from "../../atoms/identifier";

export const auctionOrganizationSchema = z.strictObject({
  organizationId: positiveBigintTextSchema,
  name: z.string().min(1).max(512).nullable(),
  type: z.string().min(1).max(64),
}).meta({ id: "AuctionOrganization", description: "Purchasing organization of one auction revision; id is the only identity." });
export type AuctionOrganization = z.infer<typeof auctionOrganizationSchema>;
```

`api/v1/auctions/resource.ts`: `organization: auctionOrganizationSchema.nullable()` 필드를 `identity` 다음에 추가.

`api/v1/organizations/attempt.resource.ts`:
```ts
import { z } from "zod";
import { nonNegativeCountSchema } from "../../../atoms/count";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";
import { moneyWireSchema } from "../../../values/money";
import { percentagePointsWireSchema } from "../../../values/rate";

export const organizationAuctionAttemptSchema = z.strictObject({
  attemptId: positiveBigintTextSchema,
  announcedAt: instantTextSchema,
  openedAt: instantTextSchema.nullable(),
  item: z.strictObject({ codeValueId: positiveBigintTextSchema, label: z.string().min(1).max(128) }).nullable(),
  floorRate: percentagePointsWireSchema.nullable(),
  baseAmount: moneyWireSchema,
  winRate: percentagePointsWireSchema.nullable(),
  secondRate: percentagePointsWireSchema.nullable(),
  dayFloorRate: percentagePointsWireSchema.nullable(),
  listCount: nonNegativeCountSchema.nullable(),
  invalidCount: nonNegativeCountSchema.nullable(),
  winnerSupplierPartyId: positiveBigintTextSchema.nullable(),
  supersedesAttemptId: positiveBigintTextSchema.nullable(),
}).meta({ id: "OrganizationAuctionAttempt", description: "One auction attempt summarized from mart.org_round_summary." });

export const organizationAuctionAttemptsMetaSchema = z.strictObject({
  sampleCount: nonNegativeCountSchema,
  martRelease: z.string().min(1).max(64).nullable(),
  computedAt: instantTextSchema.nullable(),
  calcVersion: z.string().min(1).max(32).nullable(),
}).meta({ id: "OrganizationAuctionAttemptsMeta" });

export type OrganizationAuctionAttempt = z.infer<typeof organizationAuctionAttemptSchema>;
```

`list-auction-attempts.response.ts`:
```ts
import { z } from "zod";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { organizationAuctionAttemptSchema, organizationAuctionAttemptsMetaSchema } from "./attempt.resource";

export const organizationAuctionAttemptsV1ResponseSchema = z.strictObject({
  organizationId: positiveBigintTextSchema,
  attempts: z.array(organizationAuctionAttemptSchema).max(200),
  nextCursor: positiveBigintTextSchema.nullable(),
  meta: organizationAuctionAttemptsMetaSchema,
}).meta({ id: "EatbidApiV1OrganizationAuctionAttempts" });
export type OrganizationAuctionAttemptsV1Response = z.infer<typeof organizationAuctionAttemptsV1ResponseSchema>;
```

`operations.ts`:
```ts
/** @module 책임: v1 기관 회차 이력 조회의 semantic route·query·상태별 공개 schema 계약을 소유한다. */
import { z } from "zod";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { problemDetailsSchema } from "../../../common/problem-details";
import { createOperationRegistry, defineOperation, pathParameter } from "../../operation";
import { organizationAuctionAttemptsV1ResponseSchema } from "./list-auction-attempts.response";

// limit 상한 200은 pages-endpoints-load.md의 "기관 회차 ≤ 200" 점 조회 상한과 같다.
export const organizationAuctionAttemptsQuerySchema = z.strictObject({
  item: positiveBigintTextSchema.optional(),
  cursor: positiveBigintTextSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(12),
});

export const organizationV1Operations = {
  listAuctionAttempts: defineOperation({
    method: "get",
    versioning: { kind: "uri", prefix: "api", version: "1" },
    route: { resource: "organizations", segments: [pathParameter("organizationId"), "auction-attempts"] },
    operationId: "listOrganizationAuctionAttempts",
    implementationOwner: "server",
    summary: "기관의 회차 요약을 최근 순으로 조회한다",
    tags: ["procurement"],
    pathSchema: z.strictObject({ organizationId: positiveBigintTextSchema }),
    querySchema: organizationAuctionAttemptsQuerySchema.optional(),
    bodySchema: z.undefined(),
    successResponses: { 200: { description: "기관 회차 요약 조회 성공", schema: organizationAuctionAttemptsV1ResponseSchema } },
    problemResponses: {
      400: { description: "기관 ID 또는 query가 유효하지 않음", schema: problemDetailsSchema },
      404: { description: "기관을 찾을 수 없음", schema: problemDetailsSchema },
      500: { description: "예상하지 못한 서버 결함", schema: problemDetailsSchema },
      503: { description: "데이터베이스를 사용할 수 없음", schema: problemDetailsSchema },
    },
  }),
} as const;

export const organizationV1OperationRegistry = createOperationRegistry([organizationV1Operations.listAuctionAttempts] as const);
```
`querySchema.parse({})`가 `{ limit: 12 }`를 주려면 `.optional()`이 아니라 `.default({})`가 필요할 수 있다. 테스트 Step 1의 두 번째 케이스가 통과하는 쪽을 택하고, `buildPath({ path })`(query 생략)도 통과해야 한다. 둘 다 만족하는 형태는 `organizationAuctionAttemptsQuerySchema.default({})`이다.

`index.ts`: auctions/index.ts와 같은 형태로 `organizationV1Operations`, `organizationV1OperationRegistry`, `organizationAuctionAttemptsV1ResponseSchema`, 타입 `OrganizationAuctionAttemptsV1Response`, `OrganizationAuctionAttempt`, 그리고 `../../operation`의 타입 재수출.

`registry.ts`: `...organizationV1OperationRegistry` 추가. `src/index.ts`: `export * from "./api/v1/organizations";`, `export * from "./resources/procurement/organization";`, `export * from "./atoms/count";`. `package.json` exports에 `"./api/v1/organizations"` 항목(auctions와 동일 형태).

- [ ] **Step 4: 통과 확인** — `pnpm --filter @eatbid/contracts test`, `pnpm lint:endpoints`, `pnpm contracts:check`.
- [ ] **Step 5: 커밋** — `feat(contracts): 기관 회차 이력 operation과 공고 organization 필드를 정의한다`

---

### Task 2: mart.org_round_summary Drizzle 테이블과 마이그레이션

**Files:**
- Create: `packages/db/src/schema/mart/round-summary.ts`, `packages/db/src/schema/mart/index.ts`
- Modify: `packages/db/src/schema/index.ts` (`export * from "./mart/index.js";`), `packages/db/src/version.ts`
- Create: `packages/db/drizzle/<timestamp>_mart_org_round_summary/{migration.sql,snapshot.json}` (drizzle-kit 생성물)
- Test: `packages/db/src/schema/mart/round-summary.test.ts`

**Interfaces:**
- Produces: 테이블 `mart.org_round_summary` 열 — `auction_attempt_id`(PK, FK core.auction_attempt), `organization_id`(FK core.organization), `item_code_value_id`(FK core.code_value, null), `item_label`(text null), `announced_at`(timestamptz), `opened_at`(null), `floor_rate numeric(6,3)`, `base_amount numeric(18,2)`, `currency char(3)`, `win_rate`, `second_rate`, `day_floor_rate`(numeric(6,3) null), `list_count`, `invalid_count`(integer null), `winner_supplier_party_id`(bigint null, FK 없음), `supersedes_attempt_id`(bigint null, FK core.auction_attempt), `mart_release varchar(64)`, `computed_at timestamptz`, `calc_version varchar(32)`. 인덱스 `org_round_summary_org_announced_idx (organization_id, announced_at desc, auction_attempt_id desc)`.

- [ ] **Step 1: 실패하는 테스트** — `round-summary.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { orgRoundSummary } from "./round-summary";

describe("mart.org_round_summary 스키마", () => {
  test("회차 1행이 grain이며 기관·공고 시각 역순 인덱스를 가진다", () => {
    const config = getTableConfig(orgRoundSummary);
    expect(config.schema).toBe("mart");
    expect(config.name).toBe("org_round_summary");
    expect(config.primaryKeys.length + config.columns.filter((c) => c.primary).length).toBeGreaterThan(0);
    expect(config.indexes.map((index) => index.config.name)).toContain("org_round_summary_org_announced_idx");
  });

  test("비율 열은 소수 셋째 자리 numeric이고 금액은 통화를 동반한다", () => {
    const columns = Object.fromEntries(getTableConfig(orgRoundSummary).columns.map((c) => [c.name, c]));
    expect(columns.win_rate.getSQLType()).toBe("numeric(6, 3)");
    expect(columns.base_amount.getSQLType()).toBe("numeric(18, 2)");
    expect(columns.currency.notNull).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @eatbid/db test`.
- [ ] **Step 3: 구현** — `round-summary.ts`

```ts
import { bigint, char, index, integer, numeric, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { codeValue } from "../core/codes.js";
import { organization } from "../core/organizations.js";
import { auctionAttempt } from "../core/procurement.js";
import { martSchema } from "../namespaces.js";

// 회차(AuctionAttempt) 1행 요약. 흐름·과거 회차·레일 계산이 전부 이 테이블만 읽는다(architecture.md §3.3).
// 파생물이므로 publish 뒤 mart 빌드가 통째로 다시 만들 수 있어야 하며 원본 사실을 덮어쓰지 않는다.
export const orgRoundSummary = martSchema.table(
  "org_round_summary",
  {
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" }).primaryKey().references(() => auctionAttempt.auctionAttemptId),
    organizationId: bigint("organization_id", { mode: "bigint" }).notNull().references(() => organization.organizationId),
    itemCodeValueId: bigint("item_code_value_id", { mode: "bigint" }).references(() => codeValue.codeValueId),
    itemLabel: text("item_label"),
    announcedAt: timestamp("announced_at", { withTimezone: true }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    floorRate: numeric("floor_rate", { precision: 6, scale: 3 }),
    baseAmount: numeric("base_amount", { precision: 18, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    winRate: numeric("win_rate", { precision: 6, scale: 3 }),
    secondRate: numeric("second_rate", { precision: 6, scale: 3 }),
    // 그날 하한은 원본 판정(무효 상단)의 관측값이다. 계산한 실효하한을 넣지 않는다.
    dayFloorRate: numeric("day_floor_rate", { precision: 6, scale: 3 }),
    listCount: integer("list_count"),
    invalidCount: integer("invalid_count"),
    // supplier_party 테이블은 EAT-43에서 생긴다. 그때 FK를 추가하며 지금은 값만 보존한다.
    winnerSupplierPartyId: bigint("winner_supplier_party_id", { mode: "bigint" }),
    supersedesAttemptId: bigint("supersedes_attempt_id", { mode: "bigint" }).references(() => auctionAttempt.auctionAttemptId),
    martRelease: varchar("mart_release", { length: 64 }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    calcVersion: varchar("calc_version", { length: 32 }).notNull(),
  },
  (table) => [
    index("org_round_summary_org_announced_idx").on(table.organizationId, table.announcedAt.desc(), table.auctionAttemptId.desc()),
  ],
);
```
`mart/index.ts`: `export * from "./round-summary.js";`

- [ ] **Step 4: 마이그레이션 생성** — `pnpm --filter @eatbid/db db:generate --name mart_org_round_summary`. 생성 폴더 이름을 `version.ts`의 `expectedMigration`에 넣는다. `migration.sql`에 `CREATE SCHEMA "mart"`가 없으면(이미 namespaces에 martSchema가 있어도 이전 마이그레이션이 만들었는지 확인) drizzle-kit 출력이 포함한 그대로 둔다. 손으로 SQL을 고치지 않는다(AGENTS 10).
- [ ] **Step 5: 통과 확인** — `pnpm --filter @eatbid/db test`(layout/namespaces 테스트가 테이블 목록을 고정하고 있으면 그 기대값에 새 테이블을 추가), `pnpm --filter @eatbid/db db:check`.
- [ ] **Step 6: 커밋** — `feat(db): mart.org_round_summary 회차 요약 테이블과 마이그레이션을 추가한다`

---

### Task 3: 서버 — 기관 회차 이력 use case·adapter·HTTP와 공고 organization

**Files:**
- Create: `apps/server/src/modules/procurement/domain/organization-id.ts`
- Create: `apps/server/src/modules/procurement/application/organization-attempt-reader.ts`
- Create: `apps/server/src/modules/procurement/application/list-organization-auction-attempts.ts`
- Create: `apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-organization-attempt-reader.ts`
- Create: `apps/server/src/modules/procurement/presentation/http/organization.controller.ts`
- Modify: `application/auction-reader.ts`(`organization` 필드), `application/find-auction.ts`(응답 매핑), `infrastructure/drizzle/drizzle-auction-reader.ts`(left join), `platform/database/database.tokens.ts`, `database.module.ts`, `app.module.ts`, `procurement.module.ts`
- Regenerate: `apps/server/openapi/openapi.json` (`pnpm --filter @eatbid/server openapi:generate`)
- Test: `application/list-organization-auction-attempts.test.ts`, `infrastructure/drizzle/drizzle-organization-attempt-reader.test.ts`, 기존 `find-auction.test.ts`·`drizzle-auction-reader.test.ts`·HTTP e2e 테스트의 fixture에 `organization` 반영, `presentation/http/organization.controller.test.ts`(Nest testing module로 200/400/404/503)

**Interfaces:**
- Consumes: Task 1의 `organizationV1Operations.listAuctionAttempts`, `OrganizationAuctionAttemptsV1Response`, `AuctionV1Response.organization`.
- Produces:

```ts
// organization-id.ts — auction-id.ts와 같은 brand 패턴
export type OrganizationId = bigint & { readonly [organizationIdBrand]: "OrganizationId" };
export function organizationId(value: bigint): OrganizationId;
export function organizationIdToString(value: OrganizationId): string;

// organization-attempt-reader.ts
export interface OrganizationAttemptRecord {
  readonly attemptId: bigint; readonly announcedAt: Temporal.Instant; readonly openedAt: Temporal.Instant | null;
  readonly item: { readonly codeValueId: bigint; readonly label: string } | null;
  readonly floorRate: PercentagePoints | null; readonly baseAmount: Money;
  readonly winRate: PercentagePoints | null; readonly secondRate: PercentagePoints | null; readonly dayFloorRate: PercentagePoints | null;
  readonly listCount: number | null; readonly invalidCount: number | null;
  readonly winnerSupplierPartyId: bigint | null; readonly supersedesAttemptId: bigint | null;
  readonly martRelease: string; readonly computedAt: Temporal.Instant; readonly calcVersion: string;
}
export interface OrganizationAttemptQuery { readonly organizationId: OrganizationId; readonly itemCodeValueId: bigint | null; readonly cursor: bigint | null; readonly limit: number; }
export interface OrganizationAttemptPage { readonly attempts: readonly OrganizationAttemptRecord[]; readonly nextCursor: bigint | null; readonly sampleCount: number; }
export interface OrganizationAttemptReader {
  exists(id: OrganizationId): Promise<boolean>;
  listAttempts(query: OrganizationAttemptQuery): Promise<OrganizationAttemptPage>;
}
```
`AuctionRecord.organization: { organizationId: bigint; name: string | null; type: string } | null`.

- [ ] **Step 1: use case 테스트** — `list-organization-auction-attempts.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { canonicalDecimal, krw, percentagePoints, Temporal } from "@eatbid/domain";
import { ListOrganizationAuctionAttempts, OrganizationNotFound } from "./list-organization-auction-attempts";
import { AuctionDependencyUnavailable } from "./find-auction";
import { organizationId } from "../domain/organization-id";

const record = {
  attemptId: 5_796_468n, announcedAt: Temporal.Instant.from("2026-09-01T00:00:00Z"), openedAt: null,
  item: { codeValueId: 7n, label: "축산" },
  floorRate: percentagePoints(canonicalDecimal("90.000", 3)), baseAmount: krw(canonicalDecimal("2761700.00", 2)),
  winRate: percentagePoints(canonicalDecimal("90.309", 3)), secondRate: null, dayFloorRate: null,
  listCount: 17, invalidCount: 2, winnerSupplierPartyId: 9n, supersedesAttemptId: null,
  martRelease: "2026-09-04T00", computedAt: Temporal.Instant.from("2026-09-04T00:10:00Z"), calcVersion: "v1",
};

describe("ListOrganizationAuctionAttempts", () => {
  test("회차 요약을 공개 응답으로 직렬화하고 meta는 가장 최근 행에서 가져온다", async () => {
    const useCase = new ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({ attempts: [record], nextCursor: null, sampleCount: 92 }),
    });
    const response = await Effect.runPromise(useCase.execute({ organizationId: organizationId(42n), itemCodeValueId: null, cursor: null, limit: 12 }));
    expect(response.organizationId).toBe("42");
    expect(response.attempts[0]).toMatchObject({ attemptId: "5796468", winRate: { value: "90.309", unit: "percentage-points" }, baseAmount: { amount: "2761700.00", currency: "KRW" } });
    expect(response.meta).toEqual({ sampleCount: 92, martRelease: "2026-09-04T00", computedAt: "2026-09-04T00:10:00Z", calcVersion: "v1" });
  });

  test("빈 이력은 meta release를 null로 두고 실패하지 않는다", async () => {
    const useCase = new ListOrganizationAuctionAttempts({ exists: async () => true, listAttempts: async () => ({ attempts: [], nextCursor: null, sampleCount: 0 }) });
    const response = await Effect.runPromise(useCase.execute({ organizationId: organizationId(42n), itemCodeValueId: null, cursor: null, limit: 12 }));
    expect(response.meta.martRelease).toBeNull();
  });

  test("기관이 없으면 OrganizationNotFound로 실패한다", async () => {
    const useCase = new ListOrganizationAuctionAttempts({ exists: async () => false, listAttempts: async () => { throw new Error("unreachable"); } });
    const result = await Effect.runPromiseExit(useCase.execute({ organizationId: organizationId(42n), itemCodeValueId: null, cursor: null, limit: 12 }));
    expect(result._tag).toBe("Failure");
    expect(String(result)).toContain("OrganizationNotFound");
  });

  test("저장소 장애는 AuctionDependencyUnavailable로 번역한다", async () => {
    const useCase = new ListOrganizationAuctionAttempts({ exists: async () => { throw new Error("db down"); }, listAttempts: async () => { throw new Error("db down"); } });
    const result = await Effect.runPromiseExit(useCase.execute({ organizationId: organizationId(42n), itemCodeValueId: null, cursor: null, limit: 12 }));
    expect(String(result)).toContain("AuctionDependencyUnavailable");
  });
});
```

- [ ] **Step 2: adapter 테스트** — `drizzle-organization-attempt-reader.test.ts`: `mapAttemptRow`가 `win_rate: "90.309"` → `PercentagePoints`, `announced_at: Date` → `Temporal.Instant`, `list_count: 17`, `winner_supplier_party_id: "9"` → `9n`, `currency !== "KRW"`면 TypeError. `drizzle-auction-reader.test.ts`에 `organization_id/organization_name/organization_type` 열 매핑(null이면 `organization: null`) 케이스 추가.

- [ ] **Step 3: 실패 확인** — `pnpm --filter @eatbid/server test`.

- [ ] **Step 4: 구현**

use case 핵심:
```ts
export class OrganizationNotFound extends Error { readonly code = "ORGANIZATION_NOT_FOUND" as const; constructor(readonly organizationId: OrganizationId) { super(`Organization ${organizationIdToString(organizationId)} was not found`); this.name = "OrganizationNotFound"; } }

function rateText(value: PercentagePoints | null) { return value === null ? null : { value: value.toString(), unit: "percentage-points" as const }; }
```
`PercentagePoints`의 문자열 표현은 `@eatbid/domain` `rates.ts`를 읽고 기존 codec/formatter가 있으면 그것을 쓴다(값을 `Number`로 바꾸지 않는다). `computedAt`은 `z.encode(instantCodec, …)`. `toOrganizationAttemptsResponse(organizationId, page)`는 export해 controller/테스트가 재사용한다.

adapter SQL(핵심):
```sql
select summary.auction_attempt_id, summary.announced_at, summary.opened_at,
       summary.item_code_value_id, summary.item_label, summary.floor_rate, summary.base_amount, summary.currency,
       summary.win_rate, summary.second_rate, summary.day_floor_rate, summary.list_count, summary.invalid_count,
       summary.winner_supplier_party_id, summary.supersedes_attempt_id,
       summary.mart_release, summary.computed_at, summary.calc_version,
       count(*) over () as sample_count
from mart.org_round_summary summary
where summary.organization_id = ${organizationId}
  and (${itemCodeValueId}::bigint is null or summary.item_code_value_id = ${itemCodeValueId})
  and (${cursor}::bigint is null or (summary.announced_at, summary.auction_attempt_id) <
       (select c.announced_at, c.auction_attempt_id from mart.org_round_summary c where c.auction_attempt_id = ${cursor}))
order by summary.announced_at desc, summary.auction_attempt_id desc
limit ${limit + 1}
```
`limit + 1`행을 읽어 다음 페이지 유무를 판단하고 `nextCursor`는 마지막 반환 행의 `auction_attempt_id`. `count(*) over ()`는 cursor 조건을 제외한 표본 수가 아니라 필터 뒤 남은 수이므로, `sampleCount`는 별도 `select count(*) ... where organization_id = … and item 조건`으로 한 번 더 읽는다(두 쿼리, 둘 다 인덱스 range). `exists`는 `select 1 from core.organization where organization_id = ${id}`.

공고 reader: `left join core.auction_organization purchaser on purchaser.auction_revision_id = revision.auction_revision_id and purchaser.role = 'purchaser' left join core.organization org on org.organization_id = purchaser.organization_id` 로 `organization_id, organization_name, organization_type`을 선택. `mapAuctionRow`는 `organization_id`가 null이면 `organization: null`.

controller: `auction.controller.ts` 형태를 따르되 `@Query(new StandardSchemaPipe(operation.querySchema))`로 query를 받고 `item`/`cursor`를 `BigInt`로 바꾼다. 404는 `{ code: "ORGANIZATION_NOT_FOUND" }`.

조립: `ORGANIZATION_ATTEMPT_READER` 토큰, `DatabaseModuleOverrides.organizationAttemptReader`, `AppModuleRuntime.organizationAttemptReader`, `ProcurementModule` provider·controller 등록. 기존 테스트 스택(`createApp`/testing)이 `auctionReader` override를 넘기는 곳에 같은 방식으로 새 reader override를 추가.

- [ ] **Step 5: 통과 확인** — `pnpm --filter @eatbid/server test`, `pnpm --filter @eatbid/server openapi:generate` 후 `openapi:check`, `pnpm --filter @eatbid/server architecture:check`.
- [ ] **Step 6: 커밋** — `feat(server): 기관 회차 이력 조회 use case·adapter·HTTP를 잇고 공고 응답에 구매기관을 싣는다`

---

### Task 4: web 소비자 — organizations resource

**Files:**
- Create: `apps/web/src/api/organizations/list-auction-attempts.ts`, `organization-resource-error.ts`, `queries.ts`, `server.ts`, `index.ts`
- Modify: `apps/web/src/app/(workspace)/auctions/[auctionId]/__fixtures__/auction.ts`(모든 fixture에 `organization` 추가; `openAuctionFixture.organization = { organizationId: '3101', name: '창원 남산초등학교', type: 'school' }`, `auctionFixture.organization = null`), `apps/web/e2e/support/auction-contract-fixture-server.ts`의 공고 응답에도 같은 `organization`
- Create: `.../__fixtures__/attempts.ts` (`attemptsFixture`: 20회, 남산초 실데이터 형태 — `winRate` 90.0xx~90.4xx, `dayFloorRate` 일부 null, `item` 전부 `{ codeValueId: '7', label: '축산' }` 중 3회는 `{ codeValueId: '8', label: '공산' }`, `listCount` 9~94)
- Test: `apps/web/src/api/organizations/list-auction-attempts.test.ts`(auctions의 `get-auction.test.ts` 형태: 경로 조립, 응답 parse, 404 → `isOrganizationNotFoundError`)

**Interfaces:**
- Produces: `listOrganizationAuctionAttemptsFromServer({ organizationId, item?, cursor?, limit })`, `isOrganizationNotFoundError`, `parseOrganizationId`, browser `listOrganizationAuctionAttempts`, `organizationQueries.attempts(input)`.

- [ ] Step 1 테스트 → Step 2 실패 확인(`pnpm --filter @eatbid/web test`) → Step 3 구현(`get-auction.ts`·`server.ts`·`queries.ts`·`index.ts`를 그대로 본떠 operation만 바꾼다; query는 `organizationV1Operations.listAuctionAttempts.querySchema.parse(...)`로 검증해 넘긴다) → Step 4 통과 확인(`pnpm --filter @eatbid/web test`, `pnpm lint:web-boundaries`) → Step 5 커밋 `feat(web): 기관 회차 이력 계약 소비자와 fixture를 추가한다`.

---

### Task 5: web 모델 — 표시 행, "이 값이면" 계산, item param, 병행 조회

**Files:**
- Modify: `_lib/decision-search-params.ts` (`item: parseAsString`; `DecisionSearch.item: string | null`)
- Create: `_model/attempt-history.ts`, `_model/rehearsal.ts`
- Modify: `_model/load-auction-page.ts`
- Test: `_model/attempt-history.test.ts`, `_model/rehearsal.test.ts`, `_model/load-auction-page.test.ts`(없으면 생성), `_lib/decision-search-params.test.ts`

**Interfaces:**
```ts
// attempt-history.ts
export type HistoryRow = { attemptId: string; openedText: string /* 'YY-MM-DD' KST, openedAt null이면 announcedAt + ' 공고' */; itemLabel: string /* null → '미확인' */; itemCodeValueId: string | null; winRateText: string | null /* '90.309' */; winRateMilli: bigint | null; secondRateText: string | null; dayFloorText: string | null; dayFloorMilli: bigint | null; winnerText: string /* id 있으면 `#${id}`, 없으면 '—' */; listCount: number | null; invalidCount: number | null; isSelectedItem: boolean };
export type HistoryPresentation = { organizationId: string; rows: readonly HistoryRow[]; sampleCount: number; martRelease: string | null; computedAtText: string | null; calcVersion: string | null; selectedItem: { codeValueId: string; label: string } | null };
export function presentHistory(response: OrganizationAuctionAttemptsV1Response, selectedItem: string | null): HistoryPresentation;

// rehearsal.ts — 순수 함수. 입력은 HistoryRow[](선택 품목 행만)과 BidRate.
export type Rehearsal = { total: number; won: number; wonFlags: readonly boolean[] /* 오래된 → 최근 순 */; invalid: number; byYear: readonly { year: string; won: number; total: number }[]; usualListCount: number | null /* 중앙값 */; rateSpan: { min: string; max: string; median: string } | null };
export function rehearse(rows: readonly HistoryRow[], rate: BidRate): Rehearsal;
```
`toMilli`는 `_model/bid-rate.ts`의 것을 export해 재사용한다. 낙찰됐을 회차 = `rateMilli >= winRateMilli`(design `w >= MY`: 내 값이 그 회차 낙찰률 이상이면 낙찰로 친다 — 낮은 값이 이기는 사정률이 아니라 낙찰률에 가까운 위쪽이 이기는 eaT 규칙을 디자인이 그대로 쓴 것이다. 규칙 해석이 다르면 ledger에 ruling). 무효였을 회차 = `dayFloorMilli !== null && rateMilli < dayFloorMilli`.

`load-auction-page.ts`: 의존성에 `listAttempts` 추가. `getAuction` 뒤 `organization`이 있으면 `listAttempts({ organizationId, item, limit: 60 })`를 호출하고, 실패(404 포함)는 `history: { state: 'unavailable' }`로 담아 화면 전체를 죽이지 않는다. 반환 타입 `DecisionPageData = { decision: DecisionPresentation; history: { state: 'ready'; presentation: HistoryPresentation } | { state: 'no-organization' } | { state: 'unavailable' } }`.

- [ ] Step 1 테스트: `rehearsal.test.ts` 케이스 — (a) 20회 중 `90.309`로 낙찰됐을 회차 수가 fixture 기대값과 같다, (b) 그날 하한이 null인 회차는 무효 집계에서 제외된다, (c) 25회 이상이면 `byYear`가 연도별로 합산된다, (d) 행이 없으면 `rateSpan`이 null이다. `attempt-history.test.ts` — KST 날짜 텍스트, 품목 null → '미확인', 선택 품목 표시. `load-auction-page.test.ts` — organization null이면 `no-organization`, listAttempts가 throw하면 `unavailable`, 성공이면 `ready`.
- [ ] Step 2 실패 확인 → Step 3 구현 → Step 4 `pnpm --filter @eatbid/web test` 통과 → Step 5 커밋 `feat(web): 회차 이력 표시 모델과 이 값이면 계산을 추가한다`.

---

### Task 6: web UI — 흐름 SVG, 과거 회차 표, 레일 "이 값이면", 조립

**Files:**
- Create: `_ui/bid-rate-context.tsx` ('use client'; `BidRateProvider({ initialRate, children })`, `useBidRate(): { rate, setRate }`)
- Create: `_ui/flow-chart.tsx` (server component 가능, 순수 SVG)
- Create: `_ui/history-table.tsx` ('use client', `@tanstack/react-table` `useReactTable` + `getCoreRowModel` + `getSortedRowModel`)
- Create: `_ui/rehearsal-panel.tsx` ('use client', `useBidRate()` + `rehearse`)
- Modify: `_ui/bid-rail.tsx`(내부 `useState(rate)`를 context로 옮기고 하단에 `<RehearsalPanel rows=…/>` 슬롯 prop `rehearsal?: React.ReactNode` 추가), `_ui/decision-screen.tsx`, `page.tsx`, `_ui/decision-screen-skeleton.tsx`(흐름·표 자리 skeleton 높이 220/520)
- Test: `_ui/flow-chart.test.tsx`, `_ui/history-table.test.tsx`, `_ui/rehearsal-panel.test.tsx`, 기존 `bid-rail.test.tsx`·`decision-screen.test.tsx` 갱신(Provider로 감싸기)

**디자인 규격(생성기에서 옮김):**
- 흐름: `<figure>` + `<svg viewBox="0 0 784 240" role="img" aria-label="회차별 낙찰률 흐름">`. y축 사정률 창 89.900~90.700 고정, 창 밖 점은 축 경계에 화살표 `▲ 90.812`처럼 숫자를 붙인다. x는 오래된 → 최근(왼→오). 선택 품목 회차는 `currentColor` 선+점, 다른 품목은 속 빈 점(`fill="none"`). 내 값은 파란 수평선(`stroke="var(--color-primary)"` 대신 클래스 `text-blue-600`을 쓰지 말고 프로젝트 토큰 `text-primary`를 `stroke="currentColor"`로 받는 `<g className="text-primary">`). 그날 하한은 회차마다 빨간 짧은 가로 눈금(`text-destructive`). 눈금 라벨 13px, 5개(89.9/90.1/90.3/90.5/90.7). 아래 캡션: `표본 92회 · 최근 60회 표시 · mart 2026-09-04T00 · 계산 v1 · 산출 09-04 09:10`.
- 과거 회차 표: 열 순서 `개찰 | 품목 | 낙찰률 | 2등가 | 그날 하한 | 낙찰 업체 | 명단 | {rate} 썼다면`. 숫자 열 우측 정렬 `tabular-nums`, 그날 하한은 `text-destructive`, 마지막 열은 `bg-primary/10`이고 낙찰이면 `text-primary`, 놓침이면 `text-muted-foreground`. 기본 12행, 헤더 옆 `92회 · 최근 12회 표시`. 표 위 한 줄: `파란 열은 지금 값을 그때 냈다고 치고 계산한 것입니다. 실제로 낸 적은 없습니다.` 정렬은 개찰 역순 고정(TanStack `sorting` state 초기값), 열 클릭 정렬은 이번 슬라이스에 넣지 않는다.
- 레일 "이 값이면": 제목 `이 값이면`(15px/600). 행 1 `지난 {total}회 중 낙찰됐을 회차` 값 `{won}회`(파랑) 부제 `지금 값을 그때 냈다면`; total ≤ 24면 아래 칸 스트립(각 칸 flex:1, 높이 10px, 낙찰 파랑/아니면 `bg-border`), 초과면 비율 막대 + 연도별 `{won} / {total}` 줄. 행 2 `그날 하한보다 낮아 무효였을 회차` 값 `{invalid}회`(빨강) 부제 `그날 하한: 추첨 뒤 실제로 적용된 하한`, invalid 0이면 행을 숨긴다. 행 3 `보통 참여 업체` 값 `{usualListCount}곳`(중앙값), null이면 `기록 없음`.
- 화면 조립: `history.state === 'ready'`면 evidence의 흐름 PendingCard를 `<FlowChart>`로, history 슬롯을 `<HistoryTable>`로 바꾸고 `BidRail`에 `rehearsal={<RehearsalPanel rows={selectedRows} />}`. `no-organization`이면 PendingCard 이유 `이 공고의 구매기관이 아직 정규화되지 않았습니다`, `unavailable`이면 `회차 이력을 지금 불러오지 못했습니다`. `DecisionScreen` 전체를 `<BidRateProvider initialRate='90.000'>`로 감싼다(RSC가 client provider를 렌더하고 server children을 넘기는 형태).

- [ ] Step 1 테스트(testing-library + happy-dom, `userEvent`): 흐름 SVG가 선택 품목 점 수만큼 `circle[data-item="selected"]`를 그리고 창 밖 값은 `▲`/`▼` 텍스트를 붙인다; 표가 12행과 `90.000 썼다면` 헤더를 그린다; 레일 `+0.001`을 누르면 표 마지막 열과 패널 값이 함께 바뀐다(Provider 공유 확인); invalid 0이면 무효 행이 없다.
- [ ] Step 2 실패 확인 → Step 3 구현 → Step 4 `pnpm --filter @eatbid/web test`, `pnpm --filter @eatbid/web typecheck`, `pnpm --filter @eatbid/web lint`, `pnpm architecture:check` 통과 → Step 5 커밋 `feat(web): 흐름 차트·과거 회차 표·이 값이면 패널로 결정 화면 근거 영역을 채운다`.

---

### Task 7: e2e fixture 서버와 폭별 검사 확장

**Files:**
- Create: `apps/web/e2e/support/fixtures/namsan-attempts.json` — `docs/product/decision-screen-v2/design-generators/namsan_rounds.json`에서 회차 60개를 계약 모양(`OrganizationAuctionAttempt`)으로 옮긴 배열. 필드가 없는 값은 null. `attemptId`는 원본 bid id, `item`은 `{ codeValueId: '7', label: '축산' }`.
- Modify: `apps/web/e2e/support/auction-contract-fixture-server.ts` — `organizationV1Operations.listAuctionAttempts.buildPath({ path: { organizationId: '3101' } })` prefix 매칭으로 `?limit`·`?cursor`를 해석해 `organizationAuctionAttemptsV1ResponseSchema.parse(...)`한 응답을 낸다. `CLOSED_AUCTION_ID`의 organization도 `3101`.
- Modify: `apps/web/e2e/decision-screen.spec.ts` — 기존 폭별 밀림 검사 유지 + 새 테스트 `흐름 차트와 과거 회차 12행이 실데이터 모양 fixture로 그려진다`(`figure[aria-label]`·`table tbody tr` 12개·`이 값이면` 텍스트).

- [ ] Step 1 spec 작성 → Step 2 실행(`pnpm --filter @eatbid/web test:e2e:decision`, playwright config가 fixture 서버와 next dev를 띄운다) 실패 확인 → Step 3 fixture 구현 → Step 4 통과 → Step 5 커밋 `test(web): 기관 회차 fixture 서버와 결정 화면 e2e를 확장한다`.

---

### Task 8 (main agent): Chrome MCP 시각 검증과 디자인 대조

- [ ] fixture 서버(`bun e2e/support/auction-contract-fixture-server.ts`)와 `next dev --port 3101`(`API_URL=http://127.0.0.1:4410`)을 이 worktree에서 띄운다.
- [ ] Chrome MCP로 `http://127.0.0.1:3101/auctions/5796468`을 1440·1024·768에서 열어 스크린샷을 찍고, 디자인 `Merged1440.dc.html`(캔버스 아트보드)과 나란히 비교한다. 검사 항목: 흐름 창 89.9~90.7, 표 8열 순서와 정렬, 파란 열, 레일 "이 값이면" 3행, 캡션의 표본·release·산출 시각, nowrap 밀림 0, 가로 스크롤 0.
- [ ] 차이는 ledger에 적고 같은 슬라이스에서 고친다. 사용자에게 스크린샷과 차이 목록을 보고한다.

---

## 자기 검토

- 명세 대조: pages-endpoints-load.md §1 "흐름 + 과거 회차" 행(operation·query·응답 필드·mart·60행 한 번에)은 Task 1·3·5·6이, "레일 이 값이면"(엔드포인트 없음, 순수 함수)은 Task 5·6이, "대형 코호트"(60행 초과 접기)는 이번 슬라이스에서 60행 상한으로 제한(ledger 기록)한다. Linear EAT-37 acceptance의 "남산초 실데이터로 화면이 깨지지 않는다"는 Task 7·8.
- 타입 일관성: `HistoryRow`·`rehearse`·`presentHistory` 이름은 Task 5·6에서 동일. `organizationId` 값 `'3101'`은 Task 4 fixture·Task 7 서버에서 동일. `OrganizationAttemptReader.exists/listAttempts`는 Task 3 내부에서만 쓴다.
- 미결: 낙찰 업체 이름(supplier_party, EAT-43)은 없으므로 `#id`/`—`로 둔다. 품목 선택 `item` param의 초기값은 공고 응답에 품목이 없어 null(선은 모든 회차)이다. 두 항목 모두 ledger에 ruling으로 남긴다.
