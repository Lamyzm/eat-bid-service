# EAT-36 결정 화면 셸 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/auctions/[auctionId]`를 투찰 결정 화면 v2 셸로 바꾼다. 공고 단건 계약(`GET /api/v1/auctions/{auctionId}`)만으로 헤더·배너·투찰 rail을 채우고, 이력·분포·명단 영역은 "수집 전" 상태 카드로 둔다.

**Architecture:** 기존 segment private 구조(`_model` 순수 변환 → `_ui` RSC 렌더 → `page.tsx` Suspense loader)를 유지한다. 계약 응답은 `present-decision.ts`가 표시 모델로 바꾸고, rail 상태(진행 중/개찰 완료/미확인)는 주입된 현재 시각으로 순수 함수가 정한다. 투찰률·금액 계산은 문자열 BigInt 산술로 정밀도를 지킨다. 브라우저 상태(손잡이·기록)는 `bid-rail.tsx` 하나만 `'use client'`다. 기록 저장은 port 인터페이스 + 메모리 adapter까지만(영속화는 후속 슬라이스).

**Tech Stack:** Next.js 16.3 App Router(Cache Components, Suspense loader), React 19, TypeScript 5.9, Tailwind CSS v4(CSS-first, 테마 토큰), `bun:test` + `@testing-library/react`, nuqs(URL 상태), Playwright(폭별 밀림 검사).

**Spec:** `docs/product/decision-screen-v2/README.md`, `docs/product/decision-screen-v2/spec-decision-screen-v2.md`, Linear EAT-36.

## Global Constraints

- 새 화면은 레거시 `/api`를 호출하지 않는다. 데이터는 `@eatbid/contracts/api/v1/auctions`의 `find` 하나.
- 추천값·안전구간·승률 문구 금지. 표본·기간·산출 시각 없는 수치 금지. 미관측은 `미확인`.
- 색은 상태에만: `text-primary`/`bg-primary` = 내 값·행동·활성 탭, `text-destructive` = 그날 하한·무효. 테마 토큰만 쓰고 hex/oklch literal을 컴포넌트에 쓰지 않는다.
- 본문 15px 이상(`text-[15px]`), 라벨 13px(`text[13px]`)은 단위 꼬리·보조 라벨에만. 숫자는 `tabular-nums`. 줄 높이 `leading-normal` 이상(32px hero는 `leading-tight` 예외). 보더 없이 `shadow-xs`, 반경 `rounded-xl`(12px)/`rounded-lg`(8px).
- 글자 밀림·잘림 0: 값·라벨은 `whitespace-nowrap`, 컨테이너는 `min-w-0`. 1440/1280/1024/768에서 `scrollWidth <= clientWidth`.
- 문구: 그날 하한 / 낙찰·놓침·무효 / 낙찰됐을 회차 / `{값} 썼다면`. "NeaT", "탈락선", "밀림", "먹었을" 금지.
- 시간은 wire의 UTC instant 문자열을 KST로 표기하고 남은 시간은 주입된 `now`로만 계산한다. 금액은 exact decimal 문자열, `Number` 변환 금지, bigint ID는 문자열 유지.
- 파일마다 첫 줄에 `/** @module 책임: … */`. 테스트 제목은 한국어. 포맷: single quote, JSX single quote, no trailing comma, 2-space.
- 검증 명령(루트에서): `pnpm --filter @eatbid/web test`, `pnpm --filter @eatbid/web typecheck`, `pnpm --filter @eatbid/web lint`, `pnpm architecture:check`, `pnpm test:quality`.
- 커밋은 작은 단위, 한국어 메시지, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` 과 `Claude-Session: https://claude.ai/code/session_01JCsr2N2vuZVbre9agy38J9`. push 금지.

## 파일 구조

```
apps/web/src/app/(workspace)/auctions/[auctionId]/
  page.tsx                          (수정) DecisionScreen으로 교체, now 주입
  loading.tsx                       (수정) DecisionScreenSkeleton
  __fixtures__/auction.ts           (수정) 진행 중·개찰 완료 fixture 둘 추가
  _model/present-auction.ts         (유지) 원문·provenance 표시
  _model/bid-rate.ts                (신규) 투찰률 문자열 산술, 넣을 금액
  _model/rail-state.ts              (신규) 진행 중/개찰 완료/미확인 판정
  _model/present-decision.ts        (신규) 헤더·배너 표시 모델(KST 표기, 남은 시간)
  _model/load-auction-page.ts       (수정) now 전달, DecisionPresentation 반환
  _lib/decision-search-params.ts    (신규) nuqs parser: period, scope
  _lib/bid-record-port.ts           (신규) 기록 port + 메모리 adapter
  _ui/decision-frame.tsx            (신규) 2열/오버레이/바텀시트 geometry
  _ui/decision-header.tsx           (신규) 기관·조건 칩
  _ui/decision-banner.tsx           (신규) 상태 문장·품목 칩·사실 짝
  _ui/pending-card.tsx              (신규) "수집 전" 카드
  _ui/bid-rail.tsx                  (신규, 'use client') 손잡이·금액·기록
  _ui/decision-screen.tsx           (신규) 조립
  _ui/decision-screen-skeleton.tsx  (신규)
  _ui/auction-screen*.tsx           (삭제) 옛 화면과 테스트
apps/web/e2e/decision-screen.spec.ts (신규) 폭별 밀림·넘침 0
docs/product/decision-screen-v2/README.md (수정) rail 상태 판정 규칙 추가
```

---

### Task 1: 투찰률 문자열 산술

**Files:**
- Create: `apps/web/src/app/(workspace)/auctions/[auctionId]/_model/bid-rate.ts`
- Test: `apps/web/src/app/(workspace)/auctions/[auctionId]/_model/bid-rate.test.ts`

**Interfaces:**
- Produces: `type BidRate = string` (소수 셋째 자리 고정, 예 `'90.309'`), `stepBidRate(rate: BidRate, step: '-0.01' | '-0.001' | '+0.001' | '+0.01'): BidRate`, `parseBidRate(input: string): BidRate | null`, `bidAmount(baseAmount: string, rate: BidRate): string` (원 단위 정수 문자열, 내림), `formatWon(amount: string): string` (`'2,494,063'`).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, test } from 'bun:test';

import { bidAmount, formatWon, parseBidRate, stepBidRate } from './bid-rate';

describe('투찰률 산술', () => {
  test('손잡이는 소수 셋째 자리에서 정확히 더하고 뺀다', () => {
    expect(stepBidRate('90.309', '+0.001')).toBe('90.310');
    expect(stepBidRate('90.309', '-0.01')).toBe('90.299');
    expect(stepBidRate('89.999', '+0.001')).toBe('90.000');
  });

  test('0 미만이나 100 초과로는 움직이지 않는다', () => {
    expect(stepBidRate('0.005', '-0.01')).toBe('0.000');
    expect(stepBidRate('99.995', '+0.01')).toBe('100.000');
  });

  test('직접 입력은 셋째 자리로 고정하고 잘못된 값은 null이다', () => {
    expect(parseBidRate('90.3')).toBe('90.300');
    expect(parseBidRate(' 90.3091 ')).toBe('90.309');
    expect(parseBidRate('abc')).toBeNull();
    expect(parseBidRate('101')).toBeNull();
  });

  test('넣을 금액은 기초금액 × 투찰률을 원 단위로 내림하며 Number를 거치지 않는다', () => {
    expect(bidAmount('2761700.00', '90.309')).toBe('2494063');
    expect(bidAmount('9007199254740993.50', '90.000')).toBe('8106479329266894');
    expect(formatWon('2494063')).toBe('2,494,063');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @eatbid/web test src/app/\(workspace\)/auctions/\[auctionId\]/_model/bid-rate.test.ts`
Expected: FAIL, 모듈 없음.

- [ ] **Step 3: 구현**

```ts
/** @module 책임: 투찰률과 기초금액을 문자열 BigInt로 계산해 손잡이·직접 입력·넣을 금액이 부동소수 오차 없이 맞게 한다. */

export type BidRate = string;
export type BidRateStep = '-0.01' | '-0.001' | '+0.001' | '+0.01';

const RATE_SCALE = 1000n;
const MAX_RATE_MILLI = 100n * RATE_SCALE;

function toMilli(rate: string): bigint {
  const [whole, fraction = ''] = rate.split('.');
  return BigInt(whole) * RATE_SCALE + BigInt((fraction + '000').slice(0, 3));
}

function fromMilli(milli: bigint): BidRate {
  const whole = milli / RATE_SCALE;
  const fraction = (milli % RATE_SCALE).toString().padStart(3, '0');
  return `${whole}.${fraction}`;
}

/** 손잡이는 0.000~100.000 안에서만 움직인다. 밖으로 나가는 값은 경계에 붙인다. */
export function stepBidRate(rate: BidRate, step: BidRateStep): BidRate {
  const delta = toMilli(step.slice(1)) * (step.startsWith('-') ? -1n : 1n);
  const next = toMilli(rate) + delta;
  if (next < 0n) return fromMilli(0n);
  if (next > MAX_RATE_MILLI) return fromMilli(MAX_RATE_MILLI);
  return fromMilli(next);
}

export function parseBidRate(input: string): BidRate | null {
  const trimmed = input.trim();
  if (!/^\d{1,3}(\.\d+)?$/.test(trimmed)) return null;
  const milli = toMilli(trimmed);
  if (milli > MAX_RATE_MILLI) return null;
  return fromMilli(milli);
}

/** 기초금액(소수 둘째 자리 wire)에 투찰률(‰ 단위 정수)을 곱해 원 단위로 내린다. */
export function bidAmount(baseAmount: string, rate: BidRate): string {
  const [whole, fraction = ''] = baseAmount.split('.');
  const baseCents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  // base_cents × rate_milli / (100 cents × 100 percent × 1000 milli)
  return (baseCents * toMilli(rate) / 10_000_000n).toString();
}

export function formatWon(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령, PASS.

- [ ] **Step 5: 커밋**

```bash
git add "apps/web/src/app/(workspace)/auctions/[auctionId]/_model/bid-rate.ts" "apps/web/src/app/(workspace)/auctions/[auctionId]/_model/bid-rate.test.ts"
git commit -m "feat(web): 투찰률 손잡이와 넣을 금액을 문자열 BigInt로 계산한다"
```

---

### Task 2: rail 상태 판정과 결정 화면 표시 모델

**Files:**
- Create: `_model/rail-state.ts`, `_model/present-decision.ts`
- Modify: `__fixtures__/auction.ts`, `_model/load-auction-page.ts`
- Test: `_model/rail-state.test.ts`, `_model/present-decision.test.ts`, `page.test.ts`(기존 유지, 시그니처만 갱신)

**Interfaces:**
- Consumes: `AuctionV1Response`, Task 1의 `bidAmount`.
- Produces:
  - `type RailState = 'open' | 'closed' | 'unknown'`; `deriveRailState(schedule: AuctionV1Response['schedule'], nowIso: string): RailState`.
  - `type DecisionPresentation = { identity; provenance; baseAmount: { raw: string; text: string }; railState: RailState; banner: { announcedAt: string; deadlineAt: string; openedAt: string; remaining: string } }` — 모든 시각 텍스트는 KST `MM-DD HH:mm`, 미관측은 `'미확인'`.
  - `presentDecision(response: AuctionV1Response, nowIso: string): DecisionPresentation`.
  - `loadAuctionPage(params, dependencies & { readonly now: () => string })` → `DecisionPresentation | null`.

- [ ] **Step 1: fixture 둘 추가** (`__fixtures__/auction.ts` 아래에)

```ts
/** 마감·개찰이 관측된 진행 중 공고. 2026-09-03T01:30Z(10:30 KST)에 보면 마감 24시간 30분 전이다. */
export const openAuctionFixture = {
  ...auctionFixture,
  identity: { ...auctionFixture.identity, auctionId: '5796468', revisionId: '5796469', title: '창원 남산초등학교 축산물 구매' },
  schedule: { announcedAt: '2026-09-01T00:00:00Z', deadlineAt: '2026-09-04T02:00:00Z', openedAt: '2026-09-04T05:00:00Z' },
  pricing: { baseAmount: { amount: '2761700.00', currency: 'KRW' }, plannedAmount: null }
} satisfies AuctionV1Response;

/** 개찰이 끝난 공고. now가 openedAt 뒤다. */
export const closedAuctionFixture = {
  ...openAuctionFixture,
  identity: { ...openAuctionFixture.identity, auctionId: '5780681', revisionId: '5780682', status: 'CLOSED' },
  schedule: { announcedAt: '2026-08-10T00:00:00Z', deadlineAt: '2026-08-13T02:00:00Z', openedAt: '2026-08-13T05:00:00Z' }
} satisfies AuctionV1Response;

export const fixtureNow = '2026-09-03T01:30:00Z';
```

- [ ] **Step 2: 실패하는 테스트**

`_model/rail-state.test.ts`
```ts
import { describe, expect, test } from 'bun:test';

import { closedAuctionFixture, fixtureNow, openAuctionFixture, auctionFixture } from '../__fixtures__/auction';
import { deriveRailState } from './rail-state';

describe('rail 상태 판정', () => {
  test('마감 전이면 진행 중이다', () => {
    expect(deriveRailState(openAuctionFixture.schedule, fixtureNow)).toBe('open');
  });
  test('개찰 시각이 지났으면 개찰 완료다', () => {
    expect(deriveRailState(closedAuctionFixture.schedule, fixtureNow)).toBe('closed');
  });
  test('마감이 지났지만 개찰 전이면 진행 중이 아니라 미확인이다', () => {
    expect(deriveRailState({ ...openAuctionFixture.schedule, deadlineAt: '2026-09-02T00:00:00Z', openedAt: '2026-09-05T00:00:00Z' }, fixtureNow)).toBe('unknown');
  });
  test('마감이 관측되지 않았으면 미확인이다', () => {
    expect(deriveRailState(auctionFixture.schedule, fixtureNow)).toBe('unknown');
  });
});
```

`_model/present-decision.test.ts`
```ts
import { describe, expect, test } from 'bun:test';

import { auctionFixture, fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from './present-decision';

describe('결정 화면 표시 모델', () => {
  test('시각을 KST로 표기하고 남은 시간을 주입된 now로 센다', () => {
    const decision = presentDecision(openAuctionFixture, fixtureNow);
    expect(decision.banner.deadlineAt).toBe('09-04 11:00');
    expect(decision.banner.openedAt).toBe('09-04 14:00');
    expect(decision.banner.remaining).toBe('24시간 30분');
    expect(decision.baseAmount.text).toBe('2,761,700');
    expect(decision.railState).toBe('open');
  });
  test('미관측 시각은 미확인이고 남은 시간도 미확인이다', () => {
    const decision = presentDecision(auctionFixture, fixtureNow);
    expect(decision.banner.deadlineAt).toBe('미확인');
    expect(decision.banner.remaining).toBe('미확인');
    expect(decision.railState).toBe('unknown');
  });
  test('개찰이 끝났으면 남은 시간 대신 지난 시간을 쓴다', () => {
    const decision = presentDecision({ ...openAuctionFixture, schedule: { ...openAuctionFixture.schedule, deadlineAt: '2026-09-02T02:00:00Z', openedAt: '2026-09-02T05:00:00Z' } }, fixtureNow);
    expect(decision.railState).toBe('closed');
    expect(decision.banner.remaining).toBe('개찰 20시간 30분 전');
  });
});
```

- [ ] **Step 3: 실패 확인** — 두 테스트 파일 실행, 모듈 없음으로 FAIL.

- [ ] **Step 4: 구현**

`_model/rail-state.ts`
```ts
/** @module 책임: 공고 일정과 주입된 현재 시각만으로 rail이 진행 중·개찰 완료·미확인 중 무엇인지 정한다. */
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

export type RailState = 'open' | 'closed' | 'unknown';

// ISO UTC 문자열은 사전순이 시간순과 같다. Date를 만들지 않고 비교한다.
export function deriveRailState(schedule: AuctionV1Response['schedule'], nowIso: string): RailState {
  if (schedule.openedAt && nowIso >= schedule.openedAt) return 'closed';
  if (schedule.deadlineAt && nowIso < schedule.deadlineAt) return 'open';
  return 'unknown';
}
```

`_model/present-decision.ts`
```ts
/** @module 책임: 공고 계약 응답을 결정 화면의 헤더·배너·rail이 그대로 쓰는 표시 문자열로 바꾼다. */
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { formatWon } from './bid-rate';
import { deriveRailState, type RailState } from './rail-state';

export type DecisionPresentation = {
  readonly identity: AuctionV1Response['identity'];
  readonly provenance: AuctionV1Response['provenance'];
  readonly baseAmount: { readonly raw: string; readonly text: string };
  readonly railState: RailState;
  readonly banner: {
    readonly announcedAt: string;
    readonly deadlineAt: string;
    readonly openedAt: string;
    readonly remaining: string;
  };
};

const KST = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
});

/** wire instant를 KST `MM-DD HH:mm`으로. 표시 전용이라 Date를 만들되 밖으로 내보내지 않는다. */
function kst(instant: string | null): string {
  if (!instant) return '미확인';
  const parts = KST.formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function spanText(fromIso: string, toIso: string): string {
  const minutes = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
  const hours = Math.floor(minutes / 60);
  return `${hours}시간 ${minutes % 60}분`;
}

function remainingText(schedule: AuctionV1Response['schedule'], state: RailState, nowIso: string): string {
  if (state === 'open' && schedule.deadlineAt) return spanText(nowIso, schedule.deadlineAt);
  if (state === 'closed' && schedule.openedAt) return `개찰 ${spanText(schedule.openedAt, nowIso)} 전`;
  return '미확인';
}

export function presentDecision(response: AuctionV1Response, nowIso: string): DecisionPresentation {
  const railState = deriveRailState(response.schedule, nowIso);
  const [wholeAmount] = response.pricing.baseAmount.amount.split('.');
  return {
    identity: response.identity,
    provenance: response.provenance,
    baseAmount: { raw: response.pricing.baseAmount.amount, text: formatWon(wholeAmount) },
    railState,
    banner: {
      announcedAt: kst(response.schedule.announcedAt),
      deadlineAt: kst(response.schedule.deadlineAt),
      openedAt: kst(response.schedule.openedAt),
      remaining: remainingText(response.schedule, railState, nowIso)
    }
  };
}
```

`_model/load-auction-page.ts`: `AuctionPageDependencies`에 `readonly now: () => string` 추가, `presentAuction` 대신 `presentDecision(response, dependencies.now())` 반환, 반환 타입 `DecisionPresentation | null`. `page.test.ts`의 `createDependencies`에 `now: () => fixtureNow` 추가.

- [ ] **Step 5: 통과 확인** — `pnpm --filter @eatbid/web test src/app/\(workspace\)/auctions` PASS. `present-auction.test.ts`는 그대로 통과해야 한다.

- [ ] **Step 6: 커밋** — `feat(web): 공고 일정으로 rail 상태를 판정하고 결정 화면 표시 모델을 만든다`

---

### Task 3: URL 조건과 기록 port

**Files:**
- Create: `_lib/decision-search-params.ts`, `_lib/bid-record-port.ts`
- Test: `_lib/decision-search-params.test.ts`, `_lib/bid-record-port.test.ts`

**Interfaces:**
- Produces: `decisionSearchParsers = { period: parseAsStringLiteral(['12개월','3개월','이번 달','지난 달']).withDefault('12개월'), scope: parseAsStringLiteral(['전국','도','시군','이 기관']).withDefault('전국') }` (nuqs), `type DecisionSearch = { period; scope }`.
- `type BidRecord = { auctionId: string; rate: string; amount: string; recordedAt: string }`, `interface BidRecordPort { load(auctionId: string): Promise<BidRecord | null>; save(record: BidRecord): Promise<void> }`, `createMemoryBidRecordPort(): BidRecordPort`.

- [ ] **Step 1: 테스트**

```ts
// _lib/decision-search-params.test.ts
import { describe, expect, test } from 'bun:test';
import { createSerializer } from 'nuqs';

import { decisionSearchParsers } from './decision-search-params';

describe('결정 화면 URL 조건', () => {
  test('기본값은 12개월·전국이고 직렬화에서 생략된다', () => {
    const serialize = createSerializer(decisionSearchParsers);
    expect(serialize({ period: '12개월', scope: '전국' })).toBe('');
    expect(serialize({ period: '지난 달', scope: '이 기관' })).toContain('period=');
  });
  test('허용되지 않은 값은 기본값으로 돌아간다', () => {
    expect(decisionSearchParsers.period.parse('아무거나')).toBeNull();
  });
});
```

```ts
// _lib/bid-record-port.test.ts
import { describe, expect, test } from 'bun:test';

import { createMemoryBidRecordPort } from './bid-record-port';

describe('내 값 기록 port', () => {
  test('저장한 기록을 같은 공고에서 다시 읽고 다른 공고에서는 없다', async () => {
    const port = createMemoryBidRecordPort();
    await port.save({ auctionId: '5796468', rate: '90.309', amount: '2494063', recordedAt: '2026-09-03T01:32:00Z' });
    expect((await port.load('5796468'))?.rate).toBe('90.309');
    expect(await port.load('1')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인 → Step 3: 구현**

```ts
/** @module 책임: 결정 화면 전체 조건(기간·모집단)을 URL search param으로 보존하는 nuqs parser를 한 곳에서 소유한다. */
import { parseAsStringLiteral } from 'nuqs';

export const DECISION_PERIODS = ['12개월', '3개월', '이번 달', '지난 달'] as const;
export const DECISION_SCOPES = ['전국', '도', '시군', '이 기관'] as const;

export const decisionSearchParsers = {
  period: parseAsStringLiteral(DECISION_PERIODS).withDefault('12개월'),
  scope: parseAsStringLiteral(DECISION_SCOPES).withDefault('전국')
};

export type DecisionSearch = {
  readonly period: (typeof DECISION_PERIODS)[number];
  readonly scope: (typeof DECISION_SCOPES)[number];
};
```

```ts
/** @module 책임: 사용자가 적어둔 투찰값의 저장 port를 정의한다. 원본 관측값과 절대 합치지 않는 app 소유 상태이며 이 슬라이스는 메모리 adapter만 둔다. */
export type BidRecord = {
  readonly auctionId: string;
  readonly rate: string;
  readonly amount: string;
  readonly recordedAt: string;
};

export interface BidRecordPort {
  load(auctionId: string): Promise<BidRecord | null>;
  save(record: BidRecord): Promise<void>;
}

export function createMemoryBidRecordPort(): BidRecordPort {
  const records = new Map<string, BidRecord>();
  return {
    async load(auctionId) {
      return records.get(auctionId) ?? null;
    },
    async save(record) {
      records.set(record.auctionId, record);
    }
  };
}
```

- [ ] **Step 4: PASS 확인 → Step 5: 커밋** — `feat(web): 결정 화면 URL 조건 parser와 내 값 기록 port를 둔다`

---

### Task 4: 프레임·헤더·배너·수집 전 카드 (RSC)

**Files:**
- Create: `_ui/decision-frame.tsx`, `_ui/decision-header.tsx`, `_ui/decision-banner.tsx`, `_ui/pending-card.tsx`
- Test: `_ui/decision-banner.test.tsx`, `_ui/decision-header.test.tsx`

**Interfaces:**
- `DecisionFrame({ header, banner, evidence, rail, history }: { ReactNode… })` — 1280 이상 2열(`lg:grid-cols-[minmax(0,1fr)_340px]`), 그 아래 1열. `data-slot='decision-screen'`, `aria-labelledby='decision-title'`.
- `DecisionHeader({ decision, search }: { decision: DecisionPresentation; search: DecisionSearch })` — 제목 `h1#decision-title`, 오른쪽 칩 셋: 품목 `미확인 · 공고 기준`, `search.period ▾`, `search.scope ▾`.
- `DecisionBanner({ decision, record }: { decision; record: { rate: string; recordedAt: string } | null })` — 상태별 문장: open `이 공고가 열려 있습니다`, closed `개찰이 끝났습니다`, unknown `마감 시각이 아직 관측되지 않았습니다`. 사실 짝: `마감까지 {remaining} · {deadlineAt}`, `개찰 {openedAt}`, `공고 {announcedAt}`, `내 기록 {rate · time | 아직 없음}`.
- `PendingCard({ title, reason }: { title: string; reason: string })` — 회색 카드, 문구 `수집 전`.

- [ ] **Step 1: 테스트**

```tsx
// _ui/decision-banner.test.tsx
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { auctionFixture, fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import { DecisionBanner } from './decision-banner';

describe('결정 화면 배너', () => {
  test('진행 중이면 열려 있다는 문장과 마감까지 남은 시간을 보인다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(openAuctionFixture, fixtureNow)} record={null} />);
    expect(markup).toContain('이 공고가 열려 있습니다');
    expect(markup).toContain('24시간 30분');
    expect(markup).toContain('아직 없음');
    expect(markup).not.toContain('NeaT');
  });
  test('기록이 있으면 값과 시각을 보인다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(openAuctionFixture, fixtureNow)} record={{ rate: '90.309', recordedAt: '10:32' }} />);
    expect(markup).toContain('90.309 · 10:32');
  });
  test('마감이 관측되지 않았으면 미확인이라고 쓴다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(auctionFixture, fixtureNow)} record={null} />);
    expect(markup).toContain('아직 관측되지 않았습니다');
    expect(markup).toContain('미확인');
  });
});
```

```tsx
// _ui/decision-header.test.tsx
import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import { DecisionHeader } from './decision-header';

describe('결정 화면 헤더', () => {
  test('제목과 화면 조건 칩 셋을 보인다', () => {
    const screen = render(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} search={{ period: '12개월', scope: '전국' }} />);
    expect(screen.getByRole('heading', { name: openAuctionFixture.identity.title })).toBeTruthy();
    expect(screen.getByText('12개월')).toBeTruthy();
    expect(screen.getByText('전국')).toBeTruthy();
    expect(screen.getByText('공고 기준')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 실패 확인 → Step 3: 구현**

`_ui/decision-frame.tsx`
```tsx
/** @module 책임: 결정 화면과 skeleton이 공유하는 2열 geometry와 section 순서를 제공한다. */
type DecisionFrameProps = {
  readonly header: React.ReactNode;
  readonly banner: React.ReactNode;
  readonly evidence: React.ReactNode;
  readonly rail: React.ReactNode;
  readonly history: React.ReactNode;
};

// 1280 이상은 근거 열 + rail 340. 그 아래는 한 열로 쌓고 rail이 근거 위에 온다(투찰이 1차 행동).
export function DecisionFrame({ header, banner, evidence, rail, history }: DecisionFrameProps) {
  return (
    <div data-slot='decision-screen' aria-labelledby='decision-title' className='mx-auto grid w-full max-w-[1400px] min-w-0 gap-4 px-3 py-3 sm:px-4'>
      <header className='min-w-0'>{header}</header>
      <section aria-label='공고 상태' className='min-w-0'>{banner}</section>
      <div className='grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start'>
        <div className='order-2 grid min-w-0 gap-4 lg:order-1'>
          <section aria-label='근거' className='min-w-0'>{evidence}</section>
          <section aria-label='과거 회차' className='min-w-0'>{history}</section>
        </div>
        <aside aria-label='투찰' className='order-1 min-w-0 lg:order-2'>{rail}</aside>
      </div>
    </div>
  );
}
```

`_ui/decision-header.tsx`
```tsx
/** @module 책임: 기관 제목과 화면 전체 조건(품목·기간·모집단) 칩을 표시한다. 조건 변경은 후속 슬라이스의 client 칩이 맡는다. */
import type { DecisionSearch } from '../_lib/decision-search-params';
import type { DecisionPresentation } from '../_model/present-decision';

function Chip({ children, tail }: { readonly children: React.ReactNode; readonly tail?: string }) {
  return (
    <span className='inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold whitespace-nowrap text-foreground'>
      {children}
      {tail ? <span className='text-[13px] font-semibold text-muted-foreground'>{tail}</span> : null}
    </span>
  );
}

export function DecisionHeader({ decision, search }: { readonly decision: DecisionPresentation; readonly search: DecisionSearch }) {
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-3'>
      <h1 id='decision-title' className='min-w-0 truncate text-xl font-bold tracking-tight'>{decision.identity.title}</h1>
      <span className='text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>공고 {decision.identity.displayBidNumber ?? '미확인'} · 하한율 미확인</span>
      <div className='ml-auto flex items-center gap-2'>
        <Chip tail='공고 기준'>품목 미확인</Chip>
        <Chip>{search.period}</Chip>
        <Chip>{search.scope}</Chip>
      </div>
    </div>
  );
}
```

`_ui/decision-banner.tsx`
```tsx
/** @module 책임: 공고가 열렸는지·언제 닫히는지·내가 기록했는지를 사실 짝 한 줄로 보인다. 절대 위치 없이 플렉스 두 줄이다. */
import type { DecisionPresentation } from '../_model/present-decision';

type DecisionBannerProps = {
  readonly decision: DecisionPresentation;
  readonly record: { readonly rate: string; readonly recordedAt: string } | null;
};

const SENTENCE = {
  open: '이 공고가 열려 있습니다',
  closed: '개찰이 끝났습니다',
  unknown: '마감 시각이 아직 관측되지 않았습니다'
} as const;

function Fact({ label, value, tail }: { readonly label: string; readonly value: string; readonly tail?: string }) {
  return (
    <div className='flex items-baseline gap-2 whitespace-nowrap'>
      <span className='text-[13px] font-semibold text-muted-foreground/70'>{label}</span>
      <span className='text-base font-semibold tabular-nums text-foreground'>{value}</span>
      {tail ? <span className='text-[13px] font-semibold text-muted-foreground'>{tail}</span> : null}
    </div>
  );
}

export function DecisionBanner({ decision, record }: DecisionBannerProps) {
  const { banner, railState } = decision;
  return (
    <div className='relative flex flex-col gap-2 overflow-hidden rounded-xl bg-card px-5 py-3 shadow-xs'>
      <div className='absolute inset-y-0 left-0 w-1 bg-primary' aria-hidden />
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-[15px] font-semibold whitespace-nowrap text-primary'>{SENTENCE[railState]}</span>
        <span className='inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground/5 px-3 text-[15px] font-semibold whitespace-nowrap'>
          기초 {decision.baseAmount.text}원
        </span>
      </div>
      <div className='flex flex-wrap gap-x-7 gap-y-1'>
        <Fact label={railState === 'closed' ? '개찰' : '마감까지'} value={banner.remaining} tail={banner.deadlineAt} />
        <Fact label='개찰' value={banner.openedAt} />
        <Fact label='공고' value={banner.announcedAt} />
        <Fact label='내 기록' value={record ? `${record.rate} · ${record.recordedAt}` : '아직 없음'} />
      </div>
    </div>
  );
}
```

`_ui/pending-card.tsx`
```tsx
/** @module 책임: 아직 계약이 없는 영역을 숨기지 않고 "수집 전"으로 정직하게 표시한다. */
export function PendingCard({ title, reason }: { readonly title: string; readonly reason: string }) {
  return (
    <div className='rounded-xl bg-card p-4 shadow-xs'>
      <div className='flex items-baseline gap-2'>
        <span className='text-xl font-bold'>{title}</span>
        <span className='text-[13px] font-semibold text-muted-foreground'>수집 전</span>
      </div>
      <p className='mt-2 text-[15px] font-medium text-muted-foreground'>{reason}</p>
    </div>
  );
}
```

- [ ] **Step 4: PASS 확인 → Step 5: 커밋** — `feat(web): 결정 화면 프레임·헤더·배너와 수집 전 카드를 만든다`

---

### Task 5: 투찰 rail (client)

**Files:**
- Create: `_ui/bid-rail.tsx`
- Test: `_ui/bid-rail.test.tsx`

**Interfaces:**
- Consumes: Task 1 `stepBidRate/parseBidRate/bidAmount/formatWon`, Task 3 `BidRecordPort`, Task 2 `DecisionPresentation`.
- Produces: `BidRail({ decision, port, initialRate = '90.000', now }: { decision; port: BidRecordPort; initialRate?: string; now: () => string })`, `onRecord?: (record: BidRecord) => void`.

- [ ] **Step 1: 테스트**

```tsx
import { describe, expect, test } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { createMemoryBidRecordPort } from '../_lib/bid-record-port';
import { presentDecision } from '../_model/present-decision';
import { BidRail } from './bid-rail';

const decision = presentDecision(openAuctionFixture, fixtureNow);

describe('투찰 rail', () => {
  test('손잡이를 누르면 투찰률과 넣을 금액이 같이 바뀐다', () => {
    const screen = render(<BidRail decision={decision} port={createMemoryBidRecordPort()} initialRate='90.309' now={() => fixtureNow} />);
    expect(screen.getByText('2,494,063')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+0.001' }));
    expect(screen.getByDisplayValue('90.310')).toBeTruthy();
    expect(screen.getByText('2,494,091')).toBeTruthy();
  });

  test('직접 입력한 값은 셋째 자리로 고정되고 잘못된 값은 이전 값을 지킨다', () => {
    const screen = render(<BidRail decision={decision} port={createMemoryBidRecordPort()} initialRate='90.309' now={() => fixtureNow} />);
    const input = screen.getByLabelText('투찰률');
    fireEvent.change(input, { target: { value: '90.3' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('90.300')).toBeTruthy();
    fireEvent.change(input, { target: { value: '엉뚱' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('90.300')).toBeTruthy();
  });

  test('내 값 기록을 누르면 port에 저장되고 상태 줄이 값과 시각으로 바뀐다', async () => {
    const port = createMemoryBidRecordPort();
    const screen = render(<BidRail decision={decision} port={port} initialRate='90.309' now={() => fixtureNow} />);
    expect(screen.getByText('아직 기록 없음')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '내 값 기록' }));
    await waitFor(() => expect(screen.getByText('90.309 · 10:30 기록')).toBeTruthy());
    expect((await port.load(openAuctionFixture.identity.auctionId))?.amount).toBe('2494063');
  });

  test('개찰 완료면 손잡이와 기록 버튼 대신 복기 안내를 보인다', () => {
    const closed = presentDecision({ ...openAuctionFixture, schedule: { ...openAuctionFixture.schedule, deadlineAt: '2026-09-02T02:00:00Z', openedAt: '2026-09-02T05:00:00Z' } }, fixtureNow);
    const screen = render(<BidRail decision={closed} port={createMemoryBidRecordPort()} now={() => fixtureNow} />);
    expect(screen.queryByRole('button', { name: '내 값 기록' })).toBeNull();
    expect(screen.getByText('개찰이 끝난 공고입니다')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 실패 확인 → Step 3: 구현**

```tsx
'use client';
/** @module 책임: 투찰률 손잡이·직접 입력·넣을 금액·내 값 기록의 브라우저 상태를 소유한다. 추천값은 만들지 않고 사용자가 정한 값만 다룬다. */
import { useState } from 'react';

import { type BidRecord, type BidRecordPort } from '../_lib/bid-record-port';
import { type BidRate, type BidRateStep, bidAmount, formatWon, parseBidRate, stepBidRate } from '../_model/bid-rate';
import type { DecisionPresentation } from '../_model/present-decision';

type BidRailProps = {
  readonly decision: DecisionPresentation;
  readonly port: BidRecordPort;
  readonly initialRate?: BidRate;
  readonly now: () => string;
  readonly onRecord?: (record: BidRecord) => void;
};

const STEPS: readonly BidRateStep[] = ['-0.01', '-0.001', '+0.001', '+0.01'];

function kstClock(instant: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instant));
}

export function BidRail({ decision, port, initialRate = '90.000', now, onRecord }: BidRailProps) {
  const [rate, setRate] = useState<BidRate>(initialRate);
  const [draft, setDraft] = useState(initialRate);
  const [record, setRecord] = useState<BidRecord | null>(null);
  const amount = bidAmount(decision.baseAmount.raw, rate);

  if (decision.railState === 'closed') {
    return (
      <div className='rounded-xl bg-card p-4 shadow-xs'>
        <span className='text-xl font-bold'>복기</span>
        <p className='mt-2 text-[15px] font-medium text-muted-foreground'>개찰이 끝난 공고입니다. 결과 명단은 다음 슬라이스에서 붙습니다.</p>
      </div>
    );
  }

  function commitDraft() {
    const parsed = parseBidRate(draft);
    if (parsed) setRate(parsed);
    setDraft(parsed ?? rate);
  }

  function applyStep(step: BidRateStep) {
    const next = stepBidRate(rate, step);
    setRate(next);
    setDraft(next);
  }

  async function saveRecord() {
    const next: BidRecord = { auctionId: decision.identity.auctionId, rate, amount, recordedAt: now() };
    await port.save(next);
    setRecord(next);
    onRecord?.(next);
  }

  return (
    <div className='flex flex-col gap-2.5 rounded-xl bg-card p-4 shadow-xs'>
      <span className='text-xl font-bold'>투찰</span>
      <div className='flex h-16 items-center rounded-lg bg-foreground/[0.04] px-4'>
        <label htmlFor='bid-rate' className='flex flex-col'>
          <span className='text-[15px] font-semibold text-muted-foreground'>투찰률</span>
          <span className='text-[15px] font-medium text-muted-foreground'>눌러서 직접 입력</span>
        </label>
        <input id='bid-rate' inputMode='decimal' value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commitDraft}
          className='ml-auto w-36 bg-transparent text-right text-[32px] leading-none font-bold tracking-tight tabular-nums outline-none' />
      </div>
      <div className='flex gap-1.5'>
        {STEPS.map((step) => (
          <button key={step} type='button' onClick={() => applyStep(step)}
            className='h-11 flex-1 rounded-lg bg-foreground/5 text-[15px] font-semibold tabular-nums whitespace-nowrap'>
            {step.replace('-', '−')}
          </button>
        ))}
      </div>
      <div className='flex items-center gap-2 px-1'>
        <span className='text-[15px] font-semibold text-muted-foreground'>넣을 금액</span>
        <span className='ml-auto text-2xl font-bold tracking-tight tabular-nums whitespace-nowrap'>{formatWon(amount)} <span className='text-[13px] font-semibold text-muted-foreground'>원</span></span>
        <button type='button' onClick={() => navigator.clipboard?.writeText(amount)} className='h-8 rounded-lg bg-foreground/5 px-3 text-[13px] font-semibold whitespace-nowrap'>금액 복사</button>
      </div>
      <button type='button' onClick={saveRecord} className='h-12 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground'>내 값 기록</button>
      <div className='flex items-baseline gap-2 px-1'>
        <span className='flex flex-col'>
          <span className='text-[15px] font-semibold'>{record ? `${record.rate} · ${kstClock(record.recordedAt)} 기록` : '아직 기록 없음'}</span>
          <span className='text-[15px] font-medium text-muted-foreground'>내가 쓰기로 한 값을 저장합니다</span>
        </span>
        <span className='ml-auto text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>마감 {decision.banner.deadlineAt}</span>
      </div>
    </div>
  );
}
```

버튼 라벨 테스트는 `'+0.001'`로 찾으므로 `−` 치환은 마이너스 두 개에만 적용된다(테스트가 `+0.001`을 찾는다). `-0.01`/`-0.001` 버튼의 접근성 이름은 `−0.01`이 되므로 필요하면 `aria-label={step}`을 붙인다.

- [ ] **Step 4: PASS 확인 → Step 5: 커밋** — `feat(web): 투찰 rail의 손잡이·직접 입력·금액·내 값 기록을 client 상태로 만든다`

---

### Task 6: 화면 조립·route·skeleton 교체

**Files:**
- Create: `_ui/decision-screen.tsx`, `_ui/decision-screen-skeleton.tsx`
- Modify: `page.tsx`, `loading.tsx`, `loading.test.tsx`
- Delete: `_ui/auction-screen.tsx`, `_ui/auction-screen-frame.tsx`, `_ui/auction-screen-skeleton.tsx`, 그 테스트 둘
- Test: `_ui/decision-screen.test.tsx`

**Interfaces:**
- `DecisionScreen({ decision, search }: { decision: DecisionPresentation; search: DecisionSearch })` — RSC. rail은 `<BidRail decision port={memoryPort} now={…}>`을 client island로 둔다. `now`는 함수라 RSC→client로 못 넘기므로 `BidRail`이 `nowIso: string`(서버가 넘긴 초기값)과 내부 `Date.now` 대신 **`recordedAt`은 `new Date().toISOString()`** 으로 client에서 만든다(기록 시각은 사용자 행위 시각이라 브라우저 시계가 맞다). 따라서 Task 5의 `now` prop을 `now?: () => string`(테스트 주입용, 기본 `() => new Date().toISOString()`)으로 바꾼다.
- 근거 영역: `PendingCard title='비교집단' reason='낙찰률 분포 계약(EAT-38)이 붙으면 호가창이 보입니다.'`, `PendingCard title='흐름' reason='기관 회차 이력 계약(EAT-37)이 붙으면 회차별 낙찰률이 보입니다.'`; 과거 회차: `PendingCard title='과거 회차' reason='기관 회차 이력 계약(EAT-37)이 붙으면 최근 12회가 보입니다.'`.
- 원문·추적: `provenance`를 `<details>`로 접어 `원문과 추적 정보`(기존 DescriptionItem 4개) 유지.

- [ ] **Step 1: 테스트**

```tsx
import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import { DecisionScreen } from './decision-screen';

const search = { period: '12개월', scope: '전국' } as const;

describe('결정 화면', () => {
  test('서버 markup에 프레임·제목·배너·수집 전 카드 셋이 있다', () => {
    const markup = renderToStaticMarkup(<DecisionScreen decision={presentDecision(openAuctionFixture, fixtureNow)} search={search} />);
    expect(markup).toContain('data-slot="decision-screen"');
    expect(markup).toContain('aria-labelledby="decision-title"');
    expect(markup).toContain('이 공고가 열려 있습니다');
    expect((markup.match(/수집 전/g) ?? []).length).toBe(3);
    expect(markup).toContain(openAuctionFixture.provenance.contentSha256);
  });
  test('금지 문구가 없다', () => {
    const markup = renderToStaticMarkup(<DecisionScreen decision={presentDecision(openAuctionFixture, fixtureNow)} search={search} />);
    for (const banned of ['NeaT', '탈락선', '밀림', '추천', '안전 구간']) expect(markup).not.toContain(banned);
  });
  test('section 순서가 상태·근거·과거 회차·투찰이다', () => {
    const screen = render(<DecisionScreen decision={presentDecision(openAuctionFixture, fixtureNow)} search={search} />);
    const labels = [...screen.container.querySelectorAll('section, aside')].map((node) => node.getAttribute('aria-label'));
    expect(labels).toEqual(['공고 상태', '근거', '과거 회차', '투찰']);
  });
});
```

- [ ] **Step 2: 실패 확인 → Step 3: 구현**

`_ui/decision-screen.tsx`
```tsx
/** @module 책임: 결정 화면 v2 셸을 조립한다. 계약이 있는 영역만 채우고 없는 영역은 수집 전 카드로 둔다. */
import type { DecisionSearch } from '../_lib/decision-search-params';
import { createMemoryBidRecordPort } from '../_lib/bid-record-port';
import type { DecisionPresentation } from '../_model/present-decision';
import { BidRail } from './bid-rail';
import { DecisionBanner } from './decision-banner';
import { DecisionFrame } from './decision-frame';
import { DecisionHeader } from './decision-header';
import { PendingCard } from './pending-card';

// 기록 port는 아직 메모리다. 영속화 adapter는 app 스키마와 함께 후속 슬라이스에서 바꾼다.
const bidRecordPort = createMemoryBidRecordPort();

export function DecisionScreen({ decision, search }: { readonly decision: DecisionPresentation; readonly search: DecisionSearch }) {
  return (
    <DecisionFrame
      header={<DecisionHeader decision={decision} search={search} />}
      banner={<DecisionBanner decision={decision} record={null} />}
      evidence={
        <div className='grid gap-4'>
          <PendingCard title='비교집단' reason='낙찰률 분포 계약(EAT-38)이 붙으면 호가창이 보입니다.' />
          <PendingCard title='흐름' reason='기관 회차 이력 계약(EAT-37)이 붙으면 회차별 낙찰률이 보입니다.' />
          <details className='rounded-xl bg-card p-4 shadow-xs'>
            <summary className='cursor-pointer text-[15px] font-semibold'>원문과 추적 정보</summary>
            <dl className='mt-3 grid gap-3 sm:grid-cols-2'>
              {[
                ['원천 시스템', decision.provenance.sourceSystem],
                ['관측 ID', decision.provenance.observationId],
                ['정규화 레코드 ID', decision.provenance.normalizedRecordId],
                ['내용 SHA-256', decision.provenance.contentSha256]
              ].map(([label, value]) => (
                <div key={label} className='grid gap-1'>
                  <dt className='text-[13px] font-semibold text-muted-foreground'>{label}</dt>
                  <dd className='min-w-0 text-[15px] font-medium break-all'>{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      }
      history={<PendingCard title='과거 회차' reason='기관 회차 이력 계약(EAT-37)이 붙으면 최근 12회가 보입니다.' />}
      rail={<BidRail decision={decision} port={bidRecordPort} />}
    />
  );
}
```

`page.tsx`: `loadAuctionPage(params, { parseAuctionId, getAuction: getAuctionFromServer, isNotFound: isAuctionNotFoundError, now: () => new Date().toISOString() })`. `searchParams`도 Suspense 안 loader에서 await해 `decisionSearchParsers`로 parse(`createLoader(decisionSearchParsers)` from `nuqs/server`)하고 `DecisionScreen`에 넘긴다. `now`는 요청 시점 값이므로 loader 안에서만 만든다(ADR 0028: params·searchParams는 Suspense 안).

`_ui/decision-screen-skeleton.tsx`: `DecisionFrame`에 각 slot을 `animate-pulse` 회색 블록으로. `loading.tsx`는 이것만 반환. `loading.test.tsx`는 `data-slot="decision-screen"` 검사로 갱신.

옛 `auction-screen*.tsx`와 테스트 삭제. `present-auction.ts`는 `presentAuction`을 쓰는 곳이 없어지면 함께 삭제하고 그 테스트도 삭제한다(금액 표기는 `present-decision`이 담당).

- [ ] **Step 4: 검증** — `pnpm --filter @eatbid/web test src/app/\(workspace\)/auctions`, `pnpm --filter @eatbid/web typecheck`, `pnpm --filter @eatbid/web lint`. 셋 다 통과.
- [ ] **Step 5: 커밋** — `feat(web): 공고 route를 결정 화면 v2 셸로 바꾼다`

---

### Task 7: 폭별 밀림 검사와 문서·품질 게이트

**Files:**
- Create: `apps/web/e2e/decision-screen.spec.ts`
- Modify: `docs/product/decision-screen-v2/README.md`, `apps/web/package.json`(`test:e2e:decision` script)

- [ ] **Step 1: Playwright 테스트** (기존 `frontend-foundation.spec.ts` 옆, 같은 config)

```ts
import { expect, test } from '@playwright/test';

import { openAuctionFixture } from '../src/app/(workspace)/auctions/[auctionId]/__fixtures__/auction';

const widths = [1440, 1280, 1024, 768];

test.describe('결정 화면 폭별 밀림', () => {
  for (const width of widths) {
    test(`${width}px에서 nowrap 글자가 줄바꿈되거나 넘치지 않는다`, async ({ page }) => {
      await page.route('**/api/v1/auctions/**', (route) => route.fulfill({ json: openAuctionFixture }));
      await page.setViewportSize({ width, height: 1200 });
      await page.goto(`/auctions/${openAuctionFixture.identity.auctionId}`);
      await page.getByText('이 공고가 열려 있습니다').waitFor();
      const report = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('[data-slot="decision-screen"] *')];
        const overflow = nodes.filter((node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== 'visible').length;
        const wrapped = nodes.filter((node) => node.children.length === 0 && node.textContent?.trim() && getComputedStyle(node).whiteSpace === 'nowrap' && node.getClientRects().length > 1).length;
        return { overflow, wrapped, bodyWidth: document.documentElement.scrollWidth };
      });
      expect(report.overflow).toBe(0);
      expect(report.wrapped).toBe(0);
      expect(report.bodyWidth).toBeLessThanOrEqual(width);
    });
  }
});
```

- [ ] **Step 2: 실행** — `pnpm --filter @eatbid/web exec playwright test decision-screen.spec.ts` (API origin은 route 가로채기라 서버 없이 dev 서버만 필요. foundation spec의 webServer 설정을 그대로 쓴다.) 네 폭 PASS. 실패하면 해당 요소에 `min-w-0`·`whitespace-nowrap`·`truncate`를 조정한다.

- [ ] **Step 3: 문서** — `docs/product/decision-screen-v2/README.md`에 절 추가:

```markdown
## rail 상태 판정 (EAT-36)

| 조건 | 상태 |
| -- | -- |
| `openedAt`이 관측됐고 now ≥ openedAt | 개찰 완료 |
| `deadlineAt`이 관측됐고 now < deadlineAt | 진행 중 |
| 그 외(마감·개찰 미관측, 마감 뒤 개찰 전) | 미확인 |

now는 요청 시점에 route loader가 주입한다. 화면은 스스로 시계를 읽지 않는다. 기록 시각만 사용자 행위 시각이라 브라우저 시계다.
```

- [ ] **Step 4: 품질 게이트** — 루트에서 `pnpm architecture:check`, `pnpm test:quality`, `pnpm --filter @eatbid/web build`. 통과 결과를 보고에 붙인다.
- [ ] **Step 5: 커밋** — `test(web): 결정 화면을 네 폭에서 밀림 없이 렌더하는지 검사한다`

---

## 자체 검토

- **명세 대조**: 헤더 조건 칩 셋 ✓(Task 4, 변경 상호작용은 후속), 배너 사실 짝 ✓, rail 손잡이·직접 입력·금액 복사·기록 ✓(Task 5), 상태 셋 ✓(Task 2; 공고 없음은 기관 진입점이 생기는 EAT-37에서), 수집 전 카드 ✓, 토큰 매핑 ✓(테마 토큰만 사용, 색은 primary/destructive), 폭 넷 ✓(Task 7; 1024 오버레이·768 바텀시트는 rail이 한 열 위로 오는 것으로 대신하고 오버레이·시트는 EAT-37 이후로 미룬다 — 명세 §C 폭 항목의 축소이며 이슈에 적는다).
- **placeholder 검사**: 없음. 모든 단계에 코드.
- **타입 일관성**: `DecisionPresentation.banner.remaining/deadlineAt/openedAt/announcedAt`, `railState`, `baseAmount.raw/text`가 Task 2·4·5·6에서 같다. `BidRail`의 `now` prop은 Task 6에서 optional로 바뀐다(Task 5 테스트는 주입한다).
