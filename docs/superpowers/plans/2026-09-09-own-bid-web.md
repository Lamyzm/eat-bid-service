# 실제 내 투찰을 결정 화면 차트에 연결한다 — 2026-09-09 (EAT-40 web)

> **실행자에게:** 이 계획은 task 단위로 실행하고 각 task 끝에서 좁은 검사를 돌린 뒤 commit한다. 체크박스는
> 진행 추적용이다. 인계 원문은 main의 `docs/operations/handoffs/2026-09-09-own-bid-web.md`이며 이 계획은 그
> 원문의 요구를 코드 단위로 옮긴 것이다. 두 문서가 어긋나면 인계 원문과 `AGENTS.md`가 우선한다.

**목표:** 로그인한 사용자가 등록한 사업자의 **실제 제출**(원본 명단 관측)을 결정 화면 흐름 차트에 `내 투찰`
점으로 보고, 점을 눌러 같은 회차·같은 revision의 참여 기록을 오른쪽에서 연다.

**아키텍처:** 공개 회차 이력(RSC, `use cache`)이 `includeRevision=true`로 revision을 실어 오면, 브라우저의
`OwnBidProvider`가 계정 세션·등록 사업자·EAT-40 batch operation 하나(`findMyBidObservations`)를 TanStack
Query로 조립해 표시 모델을 만들고, 기존 Lightweight Charts controller가 custom series 하나로 같은 날 여러
제출을 그린다. mart build 전환(409)은 `historyRead=latest`라는 유한 route 모드로 RSC를 캐시 없이 다시 읽어
표·선택·점을 같은 새 집합으로 되돌린다.

**기술 스택:** Next.js 16.3 (RSC, `use cache`, nuqs/server), React 19.2, TanStack Query 5.102, Lightweight Charts
5.2.1 custom series, `@eatbid/contracts` Zod operation, Playwright 1.62 + Bun harness + disposable PostgreSQL.

**원문:** `docs/operations/handoffs/2026-09-09-own-bid-web.md` (main), `docs/superpowers/plans/2026-09-09-own-bid-observations.md`
(backend 결정), ADR 0032 §1·§7·§9, ADR 0034, ADR 0041, `apps/web/AGENTS.md`.

## 전역 제약 (모든 task에 적용)

- 새 계약·DTO를 만들지 않는다. 입력은 `myBidObservationV1Operations.findMyBidObservations`의 command·response
  union 그대로다. 전체 roster를 회차마다 받는 N+1을 만들지 않는다.
- 사용자 사업자번호·`businessId`를 URL query에 넣지 않는다. 선택 상태는 현재 principal 안에 한정한다.
- `bidRate`는 exact 문자열(소수 셋째 자리)을 그대로 표시하고 `Number`는 렌더 좌표에만 쓴다. 100 초과를 지우지
  않는다. `submittedAmount`가 null이면 "금액 미확인"이며 `sourceCalculatedAmount`나 환산으로 채우지 않는다.
- `localStorage`를 새 SSOT로 쓰지 않는다. 인증 우회·fake-login endpoint·mock API 연결로 완료를 말하지 않는다.
- 새 응답·사업자 전환·필터 변경에서 캔버스를 다시 만들거나 `fitContent`를 호출하지 않는다. own 응답과
  사업자 ID는 `FlowChart`의 remount key에 넣지 않는다.
- Nest `/api/**` 외 새 Next Route Handler·Server Action·별도 캐시 태그 무효화를 만들지 않는다. 공유 `use cache`에
  개인 데이터를 넣지 않는다(ADR 0028 §4).
- 파일은 300줄 이하를 유지한다(AGENTS 18). 넘으면 책임으로 나눈다.
- 테스트 제목은 한국어, production 모듈 첫 줄은 `@module 책임:`, 이유 주석은 한국어(AGENTS 13·14·21·23).
- 운영 연결 dev 3002/4400과 운영 DB를 시험에 쓰지 않는다. 검증은 disposable PostgreSQL + Nest 4447 + web 3147.
- 원격 push·배포·DDL·마이그레이션·공유 outbox 전체 `workflow:sync`를 하지 않는다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `apps/server/src/testing/own-bid-http.integration.test.ts` | (수정) Vary 대소문자 무시 비교 |
| `apps/server/fixtures/own-bid.fixture.ts` | (수정) seed 함수를 export해 web fixture가 재사용 |
| `apps/server/fixtures/own-bid-web.fixture.ts` | (신규) 브라우저 검증용 seed: 개찰일·낙찰값·현재 공고·겹친 제출·다음 build |
| `apps/web/src/api/_transport/server-request.server.ts` | (수정) `uncachedServerRequest` |
| `apps/web/src/api/organizations/organization-resource-error.ts` | (수정) 409 → `OrganizationBuildChangedError` |
| `apps/web/src/api/organizations/list-auction-attempts.ts` | (수정) `hasBuildPin` 전달 |
| `apps/web/src/api/organizations/server.ts` | (수정) 결과 값 union, `...FromServerLatest` |
| `apps/web/src/api/account/find-my-bid-observations.ts` | (신규) batch 조회 transport 독립 함수·key identity |
| `apps/web/src/api/account/account-resource-error.ts` | (수정) own-bid 오류 3종 |
| `apps/web/src/api/account/queries.ts` | (수정) `bidObservations` query key(개인 하위 트리) |
| `apps/web/src/api/account/index.ts` | (수정) export |
| `apps/web/src/shared/lib/chart-colors.ts` | (수정) `CHART.own` |
| `apps/web/src/shared/lib/business-number-display.ts` | (신규) 표기 helper (setup에서 이동) |
| `apps/web/src/app/(auth)/setup/_model/registered-business-view.ts` | (수정) helper import 경로 |
| `apps/web/src/app/(workspace)/auctions/[auctionId]/_lib/decision-search-params.ts` | (수정) `historyRead` |
| `.../_model/attempt-history.ts` | (수정) `HistoryRow.revisionId`, `amountText` export |
| `.../_model/load-auction-page.ts` | (수정) includeRevision, 페이지 고정, build-changed, latest 의존성 |
| `.../_model/flow-chart-model.ts` | (수정) `FlowInspection`, 낙찰 없는 달력 |
| `.../_model/flow-series.ts` | (수정) `own` 계열 |
| `.../_model/own-bid-points.ts` | (신규) own 표시 모델(순수) |
| `.../_ui/flow-legend.tsx` | (수정) `own` 토글 |
| `.../_ui/create-flow-chart.ts` | (수정) custom series 연결, `setOwnSubmissions`, 범위 attribute |
| `.../_ui/own-bid/own-bid-series.ts` | (신규) LWC custom pane view/renderer |
| `.../_ui/own-bid/own-bid-context.tsx` | (신규) `OwnBidProvider`, `useOptionalOwnBid` |
| `.../_ui/own-bid/own-bid-controls.tsx` | (신규) 사업자 선택·상태 문구·409 복구 |
| `.../_ui/flow-chart.tsx` | (수정) own 점 주입·후보 목록·엔진 mount 조건 |
| `.../_ui/auction-roster-panel.tsx` | (수정) revision 전달 |
| `.../_ui/evidence-tabs.tsx` | (수정) `OwnBidControls` 자리, `HISTORY_PENDING_REASON` |
| `.../_ui/history-build-recovery.tsx` | (신규) RSC build-changed 복구 |
| `.../_ui/decision-screen.tsx` | (수정) build-changed 분기 |
| `.../page.tsx` | (수정) `OwnBidProvider`·latest 의존성 주입 |
| `.../__fixtures__/attempts.ts` | (수정) `revisionId` |
| `apps/web/e2e/support/organization-attempts-fixture.ts` | (수정) `includeRevision`·`expectedBuildId` 재현 |
| `apps/web/e2e/support/auction-roster-fixture.ts` | (수정) `revisionId` query 반영 |
| `apps/web/scripts/own-bid-e2e.ts` | (신규) 실제 DB·Nest·Playwright harness + build 전환 제어 |
| `apps/web/playwright.own-bid.config.ts` | (신규) |
| `apps/web/e2e/own-bid.spec.ts` | (신규) |
| `apps/web/package.json` | (수정) `test:e2e:own-bid` |

---

### Task 0: 통합 base 확정 — Vary 검사 대소문자 무시

**파일:** 수정 `apps/server/src/testing/own-bid-http.integration.test.ts:46-50`

merge 뒤 `215ce0d`가 `Vary`를 덮어쓰지 않고 더하므로 값이 `Origin, Cookie`다. HTTP `Vary` 토큰은 대소문자를
구분하지 않으므로 검사가 소문자 `cookie`를 요구한 것이 잘못이다. 서버 코드는 손대지 않는다.

- [ ] **Step 1: 검사 수정**

```ts
function expectPrivateResponse(response: { headers: Record<string, string> }): void {
  // 개인 응답은 성공이든 실패든 공유 캐시에 남으면 안 된다. guard가 끊는 401·403에도 같은 헤더가 있어야 한다.
  expect(response.headers["cache-control"]).toBe("private, no-store");
  // Vary 토큰은 대소문자를 구분하지 않고, CORS가 먼저 붙인 `Origin`과 함께 온다(215ce0d).
  expect(response.headers["vary"].toLowerCase().split(",").map((token) => token.trim())).toContain("cookie");
}
```

- [ ] **Step 2: 그 파일만 실행**

```bash
pnpm --filter @eatbid/server exec bun test src/testing/own-bid-http.integration.test.ts --timeout 30000
```
기대: 2 pass.

- [ ] **Step 3: commit**

```bash
git add apps/server/src/testing/own-bid-http.integration.test.ts
git commit -m "test(server): 개인 응답 Vary 검사를 CORS Origin과 함께 오는 토큰 목록으로 읽는다"
```

---

### Task 1: 회차 이력에 revision을 싣고 후속 페이지를 build·asOf로 고정한다

**파일:**
- 수정 `apps/web/src/api/organizations/organization-resource-error.ts`
- 수정 `apps/web/src/api/organizations/list-auction-attempts.ts`
- 수정 `apps/web/src/api/organizations/server.ts`
- 수정 `apps/web/src/app/(workspace)/auctions/[auctionId]/_model/attempt-history.ts`
- 수정 `apps/web/src/app/(workspace)/auctions/[auctionId]/_model/load-auction-page.ts`
- 수정 `apps/web/src/app/(workspace)/auctions/[auctionId]/__fixtures__/attempts.ts`
- 검사 `.../_model/attempt-history.test.ts`, `.../_model/load-auction-page.test.ts`, `apps/web/src/api/organizations/list-auction-attempts.test.ts`

**Interfaces:**
- Produces: `HistoryRow.revisionId: string | null`, `HistoryLoadResult` 상태 `'build-changed'`,
  `OrganizationAttemptsRead` union, `listOrganizationAuctionAttemptsFromServer(): Promise<OrganizationAttemptsRead>`,
  `isOrganizationBuildChangedError`.

- [ ] **Step 1: 실패하는 검사 — revision 보존**

`attempt-history.test.ts`에 추가:

```ts
test('요청한 revision을 행에 그대로 보존하고 없으면 최신으로 추정하지 않는다', () => {
  const withRevision = { ...attemptsFixture.attempts[0]!, revisionId: '9007199254740999' };
  const { revisionId: _omitted, ...withoutRevision } = attemptsFixture.attempts[1]!;
  const rows = presentHistory({ ...attemptsFixture, attempts: [withRevision, withoutRevision] }, null).rows;
  expect(rows[0]?.revisionId).toBe('9007199254740999');
  expect(rows[1]?.revisionId).toBeNull();
});
```

- [ ] **Step 2: 실패 확인** — `pnpm --filter @eatbid/web exec bun test src/app --timeout 30000 -t revision` → 타입 오류로 실패.

- [ ] **Step 3: `attempt-history.ts`**

`HistoryRow`에 `attemptId` 바로 아래:
```ts
  /** 이 요약이 요약한 해석이다. 서버가 opt-in을 무시한 응답은 null이며, null을 최신 revision으로 추정하지 않는다. */
  readonly revisionId: string | null;
```
`presentRow`에 `revisionId: attempt.revisionId ?? null,`. `amountText`를 `export function amountText`로 바꾼다(Task 5가 재사용).

- [ ] **Step 4: fixture에 revision** — `__fixtures__/attempts.ts`의 20개 attempt 각각에
`revisionId: '<attemptId>1'`(예: `'56694101'`)을 `attemptId` 다음 줄에 넣는다. 동일 규칙이라 script로 넣어도 된다:
```bash
node -e "const fs=require('fs');const p='apps/web/src/app/(workspace)/auctions/[auctionId]/__fixtures__/attempts.ts';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/attemptId: '(\d+)',\n/g,(m,id)=>m+\`    revisionId: '\${id}1',\n\`))"
```

- [ ] **Step 5: 409를 값으로 — `organization-resource-error.ts`**

```ts
class OrganizationBuildChangedError extends Error {
  readonly name = 'OrganizationBuildChangedError';
  constructor(readonly organizationId: string, cause: unknown) {
    super('고정을 요청한 자료 기준이 더 이상 활성이 아닙니다.', { cause });
  }
}
```
`mapOrganizationResourceError`의 input에 `readonly hasBuildPin: boolean`을 더하고, `hasCursor` 분기 앞에:
```ts
  // build 고정을 보낸 요청에서만 409를 전환으로 읽는다. 다른 409는 계약에 없으므로 그대로 올린다.
  if (input.hasBuildPin && error.status === 409 && error.code === 'CONFLICT') {
    return new OrganizationBuildChangedError(input.organizationId, error);
  }
```
`export function isOrganizationBuildChangedError(error: unknown): error is OrganizationBuildChangedError`.

`list-auction-attempts.ts`의 catch: `{ organizationId: path.organizationId, hasCursor: query.cursor !== undefined, hasBuildPin: query.expectedBuildId !== undefined }`.

- [ ] **Step 6: server.ts를 결과 값으로**

```ts
/**
 * 예상된 실패는 값이다. `use cache` 경계를 넘는 예외는 class 정체성을 잃어 호출자가 409와 400을 가릴 수
 * 없다(apps/web AGENTS). build 전환은 누적 목록 전체를 버려야 하는 사실이라 부분 성공으로 위장하지 않는다.
 */
export type OrganizationAttemptsRead =
  | { readonly kind: 'page'; readonly response: OrganizationAuctionAttemptsV1Response }
  | { readonly kind: 'build-changed' }
  | { readonly kind: 'cursor-not-found' };

async function readAttempts(request: ContractRequest, input: Omit<OrganizationAttemptsReadInput, 'signal'>): Promise<OrganizationAttemptsRead> {
  try {
    return { kind: 'page', response: await listOrganizationAuctionAttemptsWith(request, input) };
  } catch (error) {
    if (isOrganizationBuildChangedError(error)) return { kind: 'build-changed' };
    if (isOrganizationCursorInvalidError(error)) return { kind: 'cursor-not-found' };
    throw error;
  }
}

export async function listOrganizationAuctionAttemptsFromServer(input: Omit<OrganizationAttemptsReadInput, 'signal'>): Promise<OrganizationAttemptsRead> {
  'use cache';
  cacheTag(...organizationAttemptsReadCacheTags(input.organizationId));
  cacheLife(READ_CACHE_LIFE);
  return await readAttempts(serverRequest, input);
}
```
(`...FromServerLatest`는 Task 3에서 추가.)

- [ ] **Step 7: 실패하는 loader 검사**

`load-auction-page.test.ts`의 `createDependencies`를 `listAttempts: async () => ({ kind: 'page', response: attemptsFixture })`로 바꾸고 추가:

```ts
test('회차 이력에 revision을 요청하고 후속 페이지는 첫 응답의 build·asOf로 고정한다', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const first = { ...attemptsFixture, nextCursor: '5', meta: { ...attemptsFixture.meta, buildId: '501', asOf: '2026-09-06T00:00:00Z', opened: 'only' as const } };
  await loadAuctionPage(Promise.resolve({ auctionId: canonicalAuctionId }), { ...search, pages: 2 }, createDependencies({
    listAttempts: async (input) => {
      calls.push(input);
      return { kind: 'page', response: calls.length === 1 ? first : { ...attemptsFixture, nextCursor: null } };
    }
  }));
  expect(calls[0]).toMatchObject({ includeRevision: 'true' });
  expect(calls[0]).not.toHaveProperty('expectedBuildId');
  expect(calls[1]).toMatchObject({ cursor: '5', expectedBuildId: '501', asOf: '2026-09-06T00:00:00Z' });
});

test('이어 읽는 사이 build가 바뀌면 부분 목록을 싣지 않고 build-changed로 닫는다', async () => {
  let call = 0;
  const first = { ...attemptsFixture, nextCursor: '5', meta: { ...attemptsFixture.meta, buildId: '501', asOf: '2026-09-06T00:00:00Z', opened: 'only' as const } };
  const result = await loadAuctionPage(Promise.resolve({ auctionId: canonicalAuctionId }), { ...search, pages: 3 }, createDependencies({
    listAttempts: async () => (call++ === 0 ? { kind: 'page', response: first } : { kind: 'build-changed' })
  }));
  expect(result?.history).toEqual({ state: 'build-changed' });
});

test('첫 응답에 build나 asOf가 없으면 더 읽지 않고 그 사실을 남긴다', async () => {
  const first = { ...attemptsFixture, nextCursor: '5', meta: { ...attemptsFixture.meta, buildId: null, asOf: null } };
  let calls = 0;
  const result = await loadAuctionPage(Promise.resolve({ auctionId: canonicalAuctionId }), { ...search, pages: 2 }, createDependencies({
    listAttempts: async () => { calls += 1; return { kind: 'page', response: first }; }
  }));
  expect(calls).toBe(1);
  expect(result?.history.state === 'ready' && result.history.expanded.loadFailed).toBe(true);
});
```

- [ ] **Step 8: loader 구현**

`HistoryReadInput`은 그대로, `AuctionPageDependencies.listAttempts: (input) => Promise<OrganizationAttemptsRead>`.
`HistoryLoadResult`에 `| { readonly state: 'build-changed' }` 추가(주석: "이어 읽는 사이 활성 build가 바뀌었다.
부분 목록을 싣지 않고 전체를 버린다(ADR 0034)").

```ts
type MorePages =
  | { readonly kind: 'merged'; readonly merged: OrganizationAuctionAttemptsV1Response; readonly loadFailed: boolean }
  | { readonly kind: 'build-changed' };

async function loadMorePages(first, pageCount, input, listAttempts): Promise<MorePages> {
  let merged = first;
  // 첫 페이지의 build·asOf를 모든 후속 페이지에 고정한다(계약 buildPinRule). 둘 중 하나라도 없으면 고정할 수
  // 없으므로 다른 계보를 이어 붙이는 대신 더 읽지 않는다.
  const pin = first.meta.buildId !== null && first.meta.asOf !== null
    ? { expectedBuildId: first.meta.buildId, asOf: first.meta.asOf } : null;
  for (let page = 2; page <= pageCount && merged.nextCursor !== null; page += 1) {
    if (pin === null) return { kind: 'merged', merged, loadFailed: true };
    let next: OrganizationAttemptsRead;
    try {
      next = await listAttempts({ ...input, ...pin, cursor: merged.nextCursor, limit: HISTORY_PAGE_LIMIT });
    } catch {
      return { kind: 'merged', merged, loadFailed: true };
    }
    if (next.kind === 'build-changed') return { kind: 'build-changed' };
    if (next.kind === 'cursor-not-found') return { kind: 'merged', merged, loadFailed: true };
    merged = { ...merged, attempts: [...merged.attempts, ...next.response.attempts], nextCursor: next.response.nextCursor };
  }
  return { kind: 'merged', merged, loadFailed: false };
}
```
`loadHistory`: `input`에 `includeRevision: 'true' as const` 추가. 첫 페이지 `read.kind !== 'page'`면 `unavailable`
(첫 페이지에는 고정이 없어 build-changed가 올 수 없다). `more.kind === 'build-changed'`면 `{ state: 'build-changed' }`.
`listAttempts`는 Task 3에서 모드로 고른다; 지금은 `dependencies.listAttempts`.

- [ ] **Step 9: 검사·typecheck**

```bash
pnpm --filter @eatbid/web exec bun test src/app src/api/organizations --timeout 30000
pnpm --filter @eatbid/web typecheck
```
`HistoryRow` literal을 만드는 다른 검사(`rehearsal.test.ts` 등)가 `revisionId` 누락으로 깨지면 `revisionId: null`을
넣는다. `DecisionScreen` 검사의 `history: { state: ... }` union은 그대로 통과한다.

- [ ] **Step 10: commit** — `feat(web): 회차 이력에 revision을 싣고 후속 페이지를 첫 응답 build·asOf로 고정한다`

---

### Task 2: 오른쪽 참여 기록이 표·차트가 고른 revision을 반드시 전달한다

**파일:** 수정 `.../_ui/auction-roster-panel.tsx`, `.../_ui/auction-roster-panel.test.tsx`,
`apps/web/e2e/support/organization-attempts-fixture.ts`, `apps/web/e2e/support/auction-roster-fixture.ts`

- [ ] **Step 1: 실패하는 검사** — `auction-roster-panel.test.tsx`의 `clientWith`가 revision 포함 key로 저장하도록:
```ts
function clientWith(data: AuctionRosterV1Response, revisionId: string | undefined = data.revisionId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(auctionQueries.roster(data.auctionId, revisionId).queryKey, data);
  return client;
}
```
`payload(auctionId)`는 `revisionId: \`${auctionId}1\``로(fixture 규칙과 같게). 추가 검사:
```ts
test('행의 revision이 없으면 최신 명단으로 추정하지 않고 확인 불가를 말한다', () => {
  const screen = render(
    <QueryClientProvider client={clientWith(payload(selected.attemptId))}>
      <AuctionRosterPanel row={{ ...selected, revisionId: null }} onClose={() => undefined} />
    </QueryClientProvider>
  );
  expect(screen.getByRole('alert').textContent).toContain('회차 해석을 확인하지 못해');
  expect(screen.queryByText('검증 업체', { exact: false })).toBeNull();
});
```

- [ ] **Step 2: 구현** — `AuctionRosterPanel`:
```tsx
// 표와 차트가 읽은 요약의 revision을 그대로 전달한다. null이면 서버가 opt-in을 무시한 응답이라 최신 명단으로
// 추정하지 않고 확인 불가로 닫는다(인계 원문·ADR 0041 §1).
const query = useQuery({ ...auctionQueries.roster(row.attemptId, row.revisionId ?? undefined), enabled: row.revisionId !== null });
```
본문에서 `row.revisionId === null`이면 `<p role='alert'>회차 해석을 확인하지 못해 기록을 열 수 없습니다. 화면을 새로 열어 주세요.</p>`를 그리고 나머지는 생략.

- [ ] **Step 3: e2e 정적 fixture** — `organization-attempts-fixture.ts`의 `attemptResource`가
`query.includeRevision === 'true'`일 때 `revisionId: \`${attempt.attemptId}1\``을 싣는다. 또 `expectedBuildId`가 있고
`activatedBuildId(BASE_BUILD_ID)`와 다르면 `organizationProblemResponse(409, 'CONFLICT', '고정을 요청한 mart build가 더 이상 활성이 아님')`
(`problemResponses[409]` 사용). `auction-roster-fixture.ts`는 `url.searchParams.get('revisionId') ?? '99'`를 `revisionId`로 되돌린다.

- [ ] **Step 4: 검사**
```bash
pnpm --filter @eatbid/web exec bun test src/app --timeout 30000
pnpm --filter @eatbid/web test:e2e:decision
```
기대: 기존 35개 통과(fixture가 revision을 실으므로 기록 열기가 그대로 된다).

- [ ] **Step 5: commit** — `feat(web): 선택 회차 기록이 표·차트가 고른 revision의 명단을 읽는다`

---

### Task 3: `historyRead=latest` 신선도 모드와 build 전환 복구

**파일:**
- 수정 `.../_lib/decision-search-params.ts`, `.../_lib/decision-search-params.test.ts`
- 수정 `apps/web/src/api/_transport/server-request.server.ts`
- 수정 `apps/web/src/api/organizations/server.ts`
- 수정 `.../_model/load-auction-page.ts`, `.../page.tsx`
- 신규 `.../_ui/history-build-recovery.tsx`
- 수정 `.../_ui/evidence-tabs.tsx`(`HISTORY_PENDING_REASON`), `.../_ui/decision-screen.tsx`

**Interfaces:**
- Produces: `DecisionSearch.historyRead?: 'latest' | null`, `buildDecisionHistoryReadRoute(auctionId, search, mode)`,
  `listOrganizationAuctionAttemptsFromServerLatest`, `uncachedServerRequest`, `HistoryBuildRecovery`.

- [ ] **Step 1: 실패하는 검사** — `decision-search-params.test.ts`:
```ts
test('historyRead는 latest 하나뿐이며 기본 cached 경로는 주소에 남지 않는다', () => {
  expect(decisionSearchParsers.historyRead.parse('latest')).toBe('latest');
  expect(decisionSearchParsers.historyRead.parse('nonce-123')).toBeNull();
  const latest: DecisionSearch = { ...base, historyRead: 'latest' };
  expect(buildDecisionViewRoute('4821', latest, '흐름')).toContain('historyRead=latest');
  expect(buildDecisionExpandRoute('4821', latest, '과거 회차')).toContain('historyRead=latest');
  expect(buildDecisionHistoryPagesRoute('4821', latest, 2)).toContain('historyRead=latest');
  expect(buildDecisionHistoryReadRoute('4821', latest, null)).not.toContain('historyRead');
  expect(buildDecisionViewRoute('4821', base, '흐름')).not.toContain('historyRead');
});
```
(`base`는 파일의 기존 `search` literal.)

- [ ] **Step 2: parser** —
```ts
/** 409 복구가 다시 들어오는 유한 신선도 모드. nonce나 timestamp가 아니라 값 하나뿐이며 기본은 cached다. */
export const HISTORY_READ_MODES = ['latest'] as const;
...
  historyRead: parseAsStringLiteral(HISTORY_READ_MODES)
```
`DecisionSearch`에 `readonly historyRead?: (typeof HISTORY_READ_MODES)[number] | null;`.
`decisionQuery`에 `if (search.historyRead === 'latest') query.set('historyRead', 'latest');`.
```ts
/** 409 복구 전용. cached 상태에서 한 번 latest로 들어오고, 복구가 끝나면 다시 cached 주소로 돌아갈 수 있다. */
export function buildDecisionHistoryReadRoute(auctionId: string, search: DecisionSearch, mode: 'latest' | null): DecisionRoute {
  return buildDecisionViewRoute(auctionId, { ...search, historyRead: mode }, search.view);
}
```

- [ ] **Step 3: uncached transport와 server entry**

`server-request.server.ts`:
```ts
/**
 * 신선도 모드 전용이다. `use cache` 밖에서만 부르고 Next data cache에도 남기지 않는다. 바깥 `use cache`를 호출한
 * 채 안쪽 fetch만 no-store로 바꾸면 stale은 그대로라 별도 entry가 필요하다(인계 원문).
 */
export const uncachedServerRequest = createContractRequest({
  fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  resolveOrigin: () => readServerApiOrigin(process.env)
});
```
`api/organizations/server.ts`:
```ts
/**
 * `historyRead=latest`의 uncached entry다. 쿠키를 읽지 않고 공유 캐시에도 쓰지 않는다. 자주 부르면 Nest를 매번
 * 부르므로 409 복구 경로에서만 쓰고 기본 진입은 cached entry다.
 */
export async function listOrganizationAuctionAttemptsFromServerLatest(input: Omit<OrganizationAttemptsReadInput, 'signal'>): Promise<OrganizationAttemptsRead> {
  return await readAttempts(uncachedServerRequest, input);
}
```

- [ ] **Step 4: loader와 page** — `AuctionPageDependencies`에 `readonly listAttemptsLatest: AuctionPageDependencies['listAttempts']`.
`loadHistory` 첫 줄: `const listAttempts = search.historyRead === 'latest' ? dependencies.listAttemptsLatest : dependencies.listAttempts;`
`page.tsx`: `listAttemptsLatest: listOrganizationAuctionAttemptsFromServerLatest`. loader 검사 `createDependencies`에
`listAttemptsLatest` 추가 + 검사:
```ts
test('historyRead=latest는 캐시 없는 읽기를 쓰고 기본 진입은 캐시 읽기를 쓴다', async () => {
  const used: string[] = [];
  const deps = createDependencies({
    listAttempts: async () => { used.push('cached'); return { kind: 'page', response: attemptsFixture }; },
    listAttemptsLatest: async () => { used.push('latest'); return { kind: 'page', response: attemptsFixture }; }
  });
  await loadAuctionPage(Promise.resolve({ auctionId: canonicalAuctionId }), search, deps);
  await loadAuctionPage(Promise.resolve({ auctionId: canonicalAuctionId }), { ...search, historyRead: 'latest' }, deps);
  expect(used).toEqual(['cached', 'latest']);
});
```

- [ ] **Step 5: 복구 컴포넌트** — `_ui/history-build-recovery.tsx`:
```tsx
/** @module 책임: RSC 회차 이력이 build 전환으로 닫혔을 때 cached→latest 자동 전환을 한 번만 하고 latest에서는 명시적 재시도만 제공한다. */
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/shared/ui/button';
import { buildDecisionHistoryReadRoute, type DecisionSearch } from '../_lib/decision-search-params';

export function HistoryBuildRecovery({ auctionId, search }: { readonly auctionId: string; readonly search: DecisionSearch }) {
  const router = useRouter();
  const latest = search.historyRead === 'latest';
  const target = buildDecisionHistoryReadRoute(auctionId, search, 'latest');
  useEffect(() => {
    // cached에서 만난 409는 latest로 한 번 옮긴다. latest에서 다시 만나면 아래 버튼만 남기고 자동 이동을 반복하지 않는다.
    if (!latest) router.replace(target);
  }, [latest, router, target]);
  if (!latest) return <p role='status' className='text-sm text-muted-foreground'>자료가 방금 갱신되어 새 기준으로 다시 불러옵니다.</p>;
  return (
    <div role='alert' className='flex flex-wrap items-center gap-3 text-sm'>
      <span>자료 기준이 다시 바뀌어 회차 이력을 불러오지 못했습니다.</span>
      <Button variant='outline' size='sm' onClick={() => router.refresh()}>다시 불러오기</Button>
    </div>
  );
}
```
`evidence-tabs.tsx`의 `HISTORY_PENDING_REASON`에 `'build-changed': '자료가 방금 갱신되어 회차 이력을 새 기준으로 다시 불러와야 합니다'`.
`decision-screen.tsx`: `history.state === 'build-changed'`면 과거 회차 자리의 `PendingCard` 아래(같은 카드 안)에
`<HistoryBuildRecovery auctionId search />`를 그린다(`PendingCard`가 children을 받지 않으면 `history` slot을
`<div className='grid gap-2'>` 로 감싼다). 흐름 탭 본문은 기존 `PendingBody`가 같은 사유를 말한다.

- [ ] **Step 6: 검사·typecheck·commit**
```bash
pnpm --filter @eatbid/web exec bun test src/app src/api --timeout 30000
pnpm --filter @eatbid/web typecheck
git commit -am "feat(web): build 전환 409를 historyRead=latest 한 번 전환으로 복구한다"
```

---

### Task 4: 계정 API에 내 투찰 batch 조회를 붙인다

**파일:** 신규 `apps/web/src/api/account/find-my-bid-observations.ts`, `.../find-my-bid-observations.test.ts`;
수정 `account-resource-error.ts`, `queries.ts`, `queries.test.ts`, `index.ts`

**Interfaces:**
- Produces:
```ts
export interface MyBidObservationsInput { readonly businessId: string; readonly organizationId: string; readonly buildId: string; readonly attempts: readonly BidObservationAttemptKey[]; readonly signal?: AbortSignal }
export function findMyBidObservationsWith(request: ContractRequest, input: MyBidObservationsInput): Promise<MyBidObservationsV1Response>
export function bidObservationsIdentity(attempts: readonly BidObservationAttemptKey[]): string
accountQueries.bidObservations(scope: PrivateWorkspaceScope, input: Omit<MyBidObservationsInput, 'signal'>)
isBidObservationsBuildChangedError, isBidObservationsRejectedError
```

- [ ] **Step 1: 실패하는 검사** — `find-my-bid-observations.test.ts`(`my-businesses.test.ts`의 request 대역 방식을 따른다):
```ts
describe('내 투찰 관측 batch 조회', () => {
  test('계약 경로·본문으로 한 번 요청하고 응답 계보가 요청 build와 같아야 받아들인다', async () => { /* request 대역이 operationId·path·body 기록, response.meta.buildId === '501' */ });
  test('응답 build가 요청과 다르면 표와 점이 다른 계보를 말하므로 거부한다', async () => { /* meta.buildId '502' → rejects BidObservationsLineageError */ });
  test('409는 build 전환, 400은 회차 조합 거부, 401·403·404·503은 계정 오류로 번역한다', async () => { /* isProblem 대역 */ });
  test('회차 조합 identity는 순서와 무관하게 같다', () => {
    expect(bidObservationsIdentity([{ attemptId: '2', revisionId: '9' }, { attemptId: '1', revisionId: '8' }]))
      .toBe(bidObservationsIdentity([{ attemptId: '1', revisionId: '8' }, { attemptId: '2', revisionId: '9' }]));
  });
});
```

- [ ] **Step 2: 오류 3종** — `account-resource-error.ts`에 `BidObservationsBuildChangedError`(409, '자료 기준이 바뀌어 내 투찰을 다시 불러와야 합니다.'),
`BidObservationsRejectedError`(400, '요청한 회차 조합을 이 자료 기준에서 찾지 못했습니다.'), `BidObservationsLineageError`(응답 계보 불일치)와
`mapBidObservationsError(request, error)`: 409→BuildChanged, 400→Rejected, 나머지는 `mapAccountResourceError`에 위임하되
404는 `RegisteredBusinessMissingError` 그대로. `is*` 세 개 export. 파일이 300줄에 가까워지면 `bid-observations-error.ts`로 분리한다.

- [ ] **Step 3: 조회 함수**
```ts
/** @module 책임: 내 투찰 관측 batch operation을 계약대로 호출하고 응답 계보가 요청 build와 같은지 소비 측에서 검증한다. */
export function bidObservationsIdentity(attempts: readonly BidObservationAttemptKey[]): string {
  // query key에 쓰는 값이다. 같은 집합을 다른 순서로 물어도 같은 cache 항목을 보게 한다.
  return attempts.map((key) => `${key.attemptId}:${key.revisionId}`).toSorted().join(',');
}
export async function findMyBidObservationsWith(request, input): Promise<MyBidObservationsV1Response> {
  const operation = myBidObservationV1Operations.findMyBidObservations;
  const path = operation.pathSchema.parse({ businessId: input.businessId });
  try {
    const response = await request({ operation, path, body: { organizationId: input.organizationId, buildId: input.buildId, attempts: [...input.attempts] }, signal: input.signal });
    // 서버는 다른 build면 409로 닫지만, 소비 측도 같은 계보인지 한 번 더 본다(인계 원문 "소비 측에서도 검증").
    if (response.meta.buildId !== input.buildId || response.organizationId !== input.organizationId || response.businessId !== path.businessId) {
      throw new BidObservationsLineageError();
    }
    return response;
  } catch (error) {
    throw mapBidObservationsError(request, error);
  }
}
```

- [ ] **Step 4: query key** — `queries.ts`의 `accountQueryKeys`에
```ts
  bidObservations: (principalId: string, workspaceId: string, businessId: string, organizationId: string, buildId: string, attempts: string) =>
    [...accountQueryKeys.workspace(principalId, workspaceId), 'bid-observations', businessId, organizationId, buildId, attempts] as const
```
`createAccountQueries`에:
```ts
    /**
     * 개인 하위 트리 아래라 계정 전환·로그아웃의 폐기가 그대로 적용된다. build·회차 집합이 key라 build 전환 뒤
     * 옛 응답을 새 표 위에 겹칠 수 없고, 늦게 도착한 이전 build 응답은 이미 버린 항목에만 닿는다.
     */
    bidObservations(scope: PrivateWorkspaceScope, input: Omit<MyBidObservationsInput, 'signal'>) {
      return queryOptions({
        queryKey: accountQueryKeys.bidObservations(scope.principalId, scope.workspaceId, input.businessId, input.organizationId, input.buildId, bidObservationsIdentity(input.attempts)),
        queryFn: ({ signal }) => findMyBidObservationsWith(request, { ...input, signal }),
        // 전환·권한 오류는 재시도로 풀리지 않는다. 자동 재시도가 복구 안내를 몇 초 늦추면 안 된다.
        retry: (count, error) => count < 1 && !isBidObservationsBuildChangedError(error) && !isAccountUnauthenticatedError(error) && !isAccountForbiddenError(error)
      });
    }
```
`queries.test.ts`에 "bidObservations key는 principal·workspace 아래에 있고 discardOtherPrincipals가 지운다" 검사 추가.
`index.ts`에 `findMyBidObservations` browser 함수와 타입·오류 판별 export.

- [ ] **Step 5: 검사·commit**
```bash
pnpm --filter @eatbid/web exec bun test src/api/account --timeout 30000
git add apps/web/src/api/account && git commit -m "feat(web): 내 투찰 관측 batch 조회를 계정 API와 개인 query key에 붙인다"
```

---

### Task 5: own 표시 모델(순수)

**파일:** 신규 `.../_model/own-bid-points.ts`, `.../_model/own-bid-points.test.ts`

**Interfaces:**
```ts
export type OwnChartPoint = {
  readonly time: UTCTimestamp; readonly value: number; readonly rateText: string; readonly amountText: string | null;
  readonly submissionId: string; readonly sourceSupplierAccountId: string; readonly row: HistoryRow;
};
export type OwnAttemptSummary = { readonly submitted: number; readonly submissions: number; readonly absent: number; readonly notObserved: number; readonly conflict: number };
export type OwnDisplayModel = { readonly points: readonly OwnChartPoint[]; readonly summary: OwnAttemptSummary; readonly resultByAttempt: ReadonlyMap<string, MyAttemptBidObservation['result']['kind']> };
export function buildOwnDisplayModel(rows: readonly HistoryRow[], attempts: readonly MyAttemptBidObservation[]): OwnDisplayModel
export function ownObservedRange(points: readonly OwnChartPoint[]): { from: number; to: number } | null
export function ownSummaryText(summary: OwnAttemptSummary): string   // '내 투찰 4건(3회차) · 명단에 없음 1회 · 명단 미관측 52회 · 확인 불가 3회'
```

- [ ] **Step 1: 실패하는 검사**
```ts
const row = (attemptId: string, revisionId: string, openedKstDay = 20_700): HistoryRow => ({ ...presentHistory(attemptsFixture, null).rows[0]!, attemptId, revisionId, openedAt: '2026-09-05T05:00:00Z', openedKstDay });
const submitted = (attemptId: string, revisionId: string, rows: Partial<MyBidSubmission>[]): MyAttemptBidObservation => ({ attemptId, revisionId, result: { kind: 'submitted', rows: rows.map((r, i) => ({ submissionId: `${attemptId}${i}`, rosterOrdinal: i, supplierPartyId: '7701', sourceSupplierAccountId: '7801', sourceCalculatedAmount: { amount: '10000000043768.00', currency: 'KRW' }, submittedAmount: null, bidRate: { value: '89.001', unit: 'percentage-points' }, rank: null, submittedAt: null, sourceStatus: { codeValueId: '7201', code: '005', scheme: 'eat:bid-status', label: null }, ...r })), rosterRowCount: rows.length, observedAt: '2026-09-05T03:04:05Z', provenance: { sourceSystem: 'eat', observationId: '6101', normalizedRecordId: '5101', contentSha256: 'a'.repeat(64) } } });

describe('내 투찰 표시 모델', () => {
  test('같은 회차의 여러 제출과 같은 날의 여러 회차를 점 하나로 합치지 않는다', () => {
    const model = buildOwnDisplayModel([row('8101', '9101'), row('8201', '9201')], [submitted('8101', '9101', [{}, { bidRate: { value: '101.975', unit: 'percentage-points' } }]), submitted('8201', '9201', [{}])]);
    expect(model.points).toHaveLength(3);
    expect(new Set(model.points.map((p) => p.submissionId)).size).toBe(3);
    expect(model.points.every((p) => p.time === model.points[0]!.time)).toBe(true);
  });
  test('비율은 원문 셋째 자리 그대로이고 100 초과를 지우지 않으며 숫자는 좌표 전용이다', () => {
    const model = buildOwnDisplayModel([row('8101', '9101')], [submitted('8101', '9101', [{ bidRate: { value: '101.975', unit: 'percentage-points' } }])]);
    expect(model.points[0]?.rateText).toBe('101.975');
    expect(model.points[0]?.value).toBe(101.975);
  });
  test('제출 금액이 없으면 계산용 자리표시자로 채우지 않고 금액 미확인이다', () => {
    const model = buildOwnDisplayModel([row('8101', '9101')], [submitted('8101', '9101', [{}, { submittedAmount: { amount: '43120180.00', currency: 'KRW' } }])]);
    expect(model.points.map((p) => p.amountText)).toEqual([null, '43,120,180']);
  });
  test('행의 revision과 다른 결과는 점으로 그리지 않고 확인 불가로 센다', () => {
    const model = buildOwnDisplayModel([row('8101', '9111')], [submitted('8101', '9101', [{}])]);
    expect(model.points).toHaveLength(0);
    expect(model.summary.conflict).toBe(1);
  });
  test('명단에 없음·미관측·증거 불일치를 서로 다른 수로 세고 문구가 미참여를 말하지 않는다', () => {
    const attempts: MyAttemptBidObservation[] = [
      { attemptId: '1', revisionId: '11', result: { kind: 'absent-from-roster', rosterRowCount: 2, observedAt: '2026-09-05T03:04:05Z', provenance: submitted('1','11',[{}]).result.kind === 'submitted' ? (submitted('1','11',[{}]).result as { provenance: never }).provenance : undefined as never } },
      { attemptId: '2', revisionId: '12', result: { kind: 'roster-not-observed', provenance: (submitted('2','12',[{}]).result as { provenance: never }).provenance } },
      { attemptId: '3', revisionId: '13', result: { kind: 'evidence-conflict', reason: 'roster-count-mismatch' } }
    ];
    const model = buildOwnDisplayModel([row('1', '11'), row('2', '12'), row('3', '13')], attempts);
    expect(model.summary).toEqual({ submitted: 0, submissions: 0, absent: 1, notObserved: 1, conflict: 1 });
    expect(ownSummaryText(model.summary)).not.toContain('미참여');
  });
  test('개찰일이 없는 행의 결과는 점으로 놓지 않는다', () => { /* row openedAt null → points 0, summary counts 그대로 */ });
});
```
(provenance 생성이 번거로우면 검사 파일 상단에 `const provenance = {...}` 상수를 두고 쓴다.)

- [ ] **Step 2: 구현** — `attempt-history.ts`의 `amountText`를 재사용하고 `chartDay`는 `flow-chart-model.ts`에서
export해 같은 x 규칙을 쓴다(현재 private → `export function chartDay`).
```ts
/** @module 책임: 내 투찰 batch 응답을 흐름 차트의 own 점과 회차 상태 요약으로 옮기며 원문 비율·금액 부재·회차별 상태 구분을 보존한다. */
export function buildOwnDisplayModel(rows, attempts): OwnDisplayModel {
  const byAttempt = new Map(rows.map((r) => [r.attemptId, r]));
  const points: OwnChartPoint[] = [];
  const resultByAttempt = new Map<string, MyAttemptBidObservation['result']['kind']>();
  const summary = { submitted: 0, submissions: 0, absent: 0, notObserved: 0, conflict: 0 };
  for (const attempt of attempts) {
    const row = byAttempt.get(attempt.attemptId);
    // 행이 없거나 revision이 다르면 어느 명단의 결과인지 말할 수 없다. 최신으로 추정하지 않는다.
    if (!row || row.revisionId !== attempt.revisionId) { summary.conflict += 1; resultByAttempt.set(attempt.attemptId, 'evidence-conflict'); continue; }
    resultByAttempt.set(attempt.attemptId, attempt.result.kind);
    switch (attempt.result.kind) {
      case 'submitted':
        summary.submitted += 1; summary.submissions += attempt.result.rows.length;
        if (row.openedAt == null) break;
        for (const s of attempt.result.rows) points.push({ time: chartDay(row.openedKstDay), value: Number(s.bidRate.value), rateText: s.bidRate.value, amountText: s.submittedAmount ? amountText(s.submittedAmount.amount) : null, submissionId: s.submissionId, sourceSupplierAccountId: s.sourceSupplierAccountId, row });
        break;
      case 'absent-from-roster': summary.absent += 1; break;
      case 'roster-not-observed': summary.notObserved += 1; break;
      case 'evidence-conflict': summary.conflict += 1; break;
    }
  }
  points.sort((a, b) => a.time - b.time || a.value - b.value);
  return { points, summary, resultByAttempt };
}
```
`ownSummaryText`: 0인 항목은 생략, 전부 0이면 `'조회한 회차에 내 제출 기록이 없습니다'`(미참여라는 단어를 쓰지 않는다).

- [ ] **Step 3: 검사·commit** — `feat(web): 내 투찰 batch 응답을 own 점과 회차 상태 요약으로 옮기는 표시 모델을 둔다`

---

### Task 6: 차트 엔진 — custom series로 own 점을 그리고 선택·범위를 유지한다

**파일:** 수정 `shared/lib/chart-colors.ts`, `.../_model/flow-series.ts`, `.../_model/flow-series.test.ts`,
`.../_ui/flow-legend.tsx`, `.../_model/flow-chart-model.ts`, `.../_model/flow-chart-model.test.ts`,
`.../_ui/create-flow-chart.ts`, `.../_ui/flow-chart.tsx`, `.../_ui/flow-chart.test.tsx`; 신규 `.../_ui/own-bid/own-bid-series.ts`

**Interfaces:**
- Consumes: `OwnChartPoint`, `ownObservedRange` (Task 5).
- Produces: `FlowSeriesKey`에 `'own'`; `CHART.own`; `FlowInspection`; controller `setOwnSubmissions(points)`;
  캔버스 요소 `data-price-range="from,to"`; `figure[data-own-points]`.

- [ ] **Step 1: 계열 어휘·색** —
`flow-series.ts`: `FlowSeriesKey = 'win' | 'runnerUp' | 'myRate' | 'own' | 'otherItems' | 'listCount'`; `FLOW_SERIES`에
`{ key: 'own', name: '내 투찰', axis: 'assessment-rate' }`를 `myRate` 다음에. 주석: "실제 제출은 가정 선 `내 값`과 이름·색·표식이 다르다.
가정을 실제로 이름만 바꾸지 않는다". `flow-series.test.ts` 기대 배열을 `['낙찰', '2등', '내 값', '내 투찰', '다른 품목', '명단']`로.
`flow-legend.tsx`: `INITIAL.own = true`, `MARK.own = { glyph: '◆', tone: 'text-fuchsia-700 dark:text-fuchsia-300' }`.
`chart-colors.ts`: `LIGHT.own '#b31cbf'`, `DARK.own '#e879f9'`, `TOSS_LIGHT.own '#c74bd6'`, `TOSS_DARK.own '#e6a0f0'`,
`CHART.own` getter(주석: "실제 제출 점. 사용자 가정 `me`(파랑)와 낙찰 `win`과 색이 겹치면 안 된다").

- [ ] **Step 2: 실패하는 모델 검사** — `flow-chart-model.test.ts`:
```ts
test('낙찰값이 하나도 없어도 개찰일이 있으면 달력을 만들어 own 점만으로 엔진이 설 수 있다', () => {
  const result = model([row('2', '2026-07-02T00:00:00Z', { winRate: null }), row('1', '2026-07-01T00:00:00Z', { winRate: null })]);
  expect(result.points).toHaveLength(0);
  expect(result.calendar).toHaveLength(2);
  expect(result.initialRange).toBeNull();
});
```
`buildFlowChartModel`은 이미 `rows`(openedAt 있는 행)로 달력을 만든다. 통과하면 그대로 두고, `flow-chart-model.ts`에
`chartDay` export와 아래 타입을 추가한다:
```ts
/** 캔버스 위 후보 하나. 낙찰 점과 내 투찰 점은 같은 날 같은 값에 겹칠 수 있어 종류를 이름으로 나눈다. */
export type FlowInspection =
  | { readonly kind: 'win'; readonly point: FlowChartPoint }
  | { readonly kind: 'own'; readonly point: OwnChartPoint };
```

- [ ] **Step 3: custom series** — `_ui/own-bid/own-bid-series.ts`(설치본 `typings.d.ts`의 `ICustomSeriesPaneView`·
`ICustomSeriesPaneRenderer`·`PaneRendererCustomData`·`CustomBarItemData` 그대로; `fancy-canvas` 타입은 직접 import하지
않고 `Parameters<ICustomSeriesPaneRenderer['draw']>[0]`로 파생한다):
```ts
/** @module 책임: 같은 날 여러 제출을 한 시간 좌표에 각각 그리는 Lightweight Charts custom series를 소유한다. 일반 LineSeries는 같은 time 중복을 버리므로 여기서만 own 점을 그린다. */
import { customSeriesDefaultOptions, type CustomData, type CustomSeriesOptions, type CustomSeriesPricePlotValues, type CustomSeriesWhitespaceData, type ICustomSeriesPaneRenderer, type ICustomSeriesPaneView, type PaneRendererCustomData, type PriceToCoordinateConverter, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { OwnChartPoint } from '../../_model/own-bid-points';

export type OwnDayDatum = CustomData<Time> & { readonly time: UTCTimestamp; readonly submissions: readonly OwnChartPoint[] };
export type OwnSeriesOptions = CustomSeriesOptions & { readonly selectedAttemptId: string | null; readonly radius: number };
type DrawTarget = Parameters<ICustomSeriesPaneRenderer['draw']>[0];

/** 날짜별 unique time 한 행에 그날의 제출 전부를 담는다. 가짜 초·jitter·평균을 넣지 않는다. */
export function toOwnDayData(points: readonly OwnChartPoint[]): OwnDayDatum[] {
  const byDay = new Map<number, OwnChartPoint[]>();
  for (const point of points) byDay.set(point.time, [...(byDay.get(point.time) ?? []), point]);
  return [...byDay.entries()].sort(([a], [b]) => a - b).map(([time, submissions]) => ({ time: time as UTCTimestamp, submissions }));
}

class OwnPointsRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, OwnDayDatum> | null = null;
  private options: OwnSeriesOptions | null = null;
  update(data: PaneRendererCustomData<Time, OwnDayDatum>, options: OwnSeriesOptions): void { this.data = data; this.options = options; }
  draw(target: DrawTarget, priceConverter: PriceToCoordinateConverter): void {
    const { data, options } = this;
    if (!data || !options || !data.visibleRange) return;
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      for (let index = data.visibleRange!.from; index < data.visibleRange!.to; index += 1) {
        const bar = data.bars[index]!;
        for (const submission of bar.originalData.submissions) {
          const y = priceConverter(submission.value);
          if (y === null) continue;
          const selected = options.selectedAttemptId === submission.row.attemptId;
          const radius = (selected ? options.radius + 2 : options.radius) * horizontalPixelRatio;
          const x = bar.x * horizontalPixelRatio;
          const cy = y * verticalPixelRatio;
          context.beginPath();
          context.moveTo(x, cy - radius); context.lineTo(x + radius, cy); context.lineTo(x, cy + radius); context.lineTo(x - radius, cy); context.closePath();
          context.fillStyle = options.color; context.fill();
          context.lineWidth = 1.5 * horizontalPixelRatio; context.strokeStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.85)'; context.stroke();
        }
      }
    });
  }
}

export class OwnPointsSeries implements ICustomSeriesPaneView<Time, OwnDayDatum, OwnSeriesOptions> {
  private readonly paneRenderer = new OwnPointsRenderer();
  renderer(): ICustomSeriesPaneRenderer { return this.paneRenderer; }
  update(data: PaneRendererCustomData<Time, OwnDayDatum>, options: OwnSeriesOptions): void { this.paneRenderer.update(data, options); }
  priceValueBuilder(row: OwnDayDatum): CustomSeriesPricePlotValues {
    const values = row.submissions.map((s) => s.value);
    return [Math.min(...values), Math.max(...values), values[values.length - 1]!];
  }
  isWhitespace(data: OwnDayDatum | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return !('submissions' in data) || data.submissions.length === 0;
  }
  defaultOptions(): OwnSeriesOptions {
    return { ...customSeriesDefaultOptions, color: '#b31cbf', selectedAttemptId: null, radius: 5, priceLineVisible: false, lastValueVisible: false };
  }
}
```
`enableConflation`은 chart 옵션 기본값 false다. `createChart` 옵션에 `enableConflation: false`를 명시해 둔다(설치본에서
이 옵션이 어느 option 객체에 있는지 typings 1497행 부근에서 확인해 그 자리에 둔다).

- [ ] **Step 4: controller** — `create-flow-chart.ts`
  - import `OwnPointsSeries, toOwnDayData`, `ownObservedRange`, `FlowInspection`.
  - `const own = chart.addCustomSeries(new OwnPointsSeries(), { color: CHART.own, selectedAttemptId: null, radius: 5, priceLineVisible: false, lastValueVisible: false });`
    (`calendar` 다음, `selected` 앞에 만들어 낙찰 선 위에 그려지게 한다.)
  - 상태: `let ownPoints: readonly OwnChartPoint[] = []; let ownByDay = new Map<number, OwnChartPoint[]>(); let ownRangeApplied = false; let selectedAttemptId: string | undefined;`
  - `const publishRange = () => { const range = chart.priceScale('right').getVisibleRange(); element.dataset.priceRange = range ? `${range.from.toFixed(3)},${range.to.toFixed(3)}` : ''; };`
    초기화 마지막(`setVisibleRange` 뒤)과 `reset`·`fit`·`zoom`·`setOwnSubmissions` 끝에서 부른다.
  - `inspect`/crosshair: 후보를 `FlowInspection[]`으로 만든다. `byDay` 낙찰 후보에 `ownByDay.get(time)`의 own 후보를
    더하고(`visibility.own`일 때만), 거리 계산은 own은 `point.value` 하나로. `onInspect(items, choose)` 시그니처 변경.
  - `fit`: `const ranges = [flowObservedRange(wins…), visibility?.own ? ownObservedRange(ownPoints) : null]` 합집합.
  - `update`: `own.applyOptions({ visible: visible.own });`
  - `select(attemptId)`: 기존 + `selectedAttemptId = attemptId; own.applyOptions({ selectedAttemptId: attemptId ?? null });`
  - 테마 observer: `own.applyOptions({ color: CHART.own })`.
  - 새 메서드:
```ts
    // own 계열만 갈아 끼운다. fitContent·remount 없이 현재 logical/price range를 유지한다. 낙찰 점이 하나도 없어
    // 초기 범위를 못 정한 캔버스에서만 첫 own 도착 때 한 번 own 범위를 놓는다.
    setOwnSubmissions: (points: readonly OwnChartPoint[]) => {
      ownPoints = points;
      ownByDay = new Map();
      for (const point of points) ownByDay.set(point.time, [...(ownByDay.get(point.time) ?? []), point]);
      own.setData(toOwnDayData(points));
      if (!ownRangeApplied && model.points.length === 0 && model.initialRange === null) {
        const range = ownObservedRange(points);
        if (range) { chart.priceScale('right').setVisibleRange(range); ownRangeApplied = true; }
      }
      publishRange();
    }
```
  파일이 300줄을 넘기면 후보 계산(`inspectionCandidates`)을 `_model/flow-inspection.ts` 순수 함수로 뺀다.

- [ ] **Step 5: 실패하는 캔버스 검사** — `flow-chart.test.tsx`:
```ts
test('낙찰 기록이 없어도 개찰일이 있으면 캔버스 자리를 만들고 낙찰 없음을 문장으로 말한다', () => {
  const noWins = { ...presentation, rows: presentation.rows.map((row) => ({ ...row, winRateText: null, winRateMilli: null })) };
  const screen = show(noWins);
  expect(screen.container.querySelector('[data-slot=flow-canvas]')).not.toBeNull();
  expect(screen.getByText('선택한 조건의 낙찰 기록이 없습니다.')).toBeTruthy();
});
test('own provider가 없으면 내 투찰 점을 0으로 표시하고 캔버스 조작은 그대로다', () => {
  expect(show().getByRole('figure').getAttribute('data-own-points')).toBe('0');
});
```
- [ ] **Step 6: `flow-chart.tsx`**
  - `const ownBid = useOptionalOwnBid(); const ownPoints = ownBid?.display?.points ?? EMPTY_POINTS;`
  - 엔진 mount 조건을 `model.calendar.length === 0`로 바꾸고(낙찰 점 0이어도 달력이 있으면 mount), 본문 분기:
    달력 없음 → 기존 문장; 달력 있고 점 0 → 캔버스 위에 `<p className='text-sm text-muted-foreground'>선택한 조건의 낙찰 기록이 없습니다.</p>`.
  - `initialize`에 `api.setOwnSubmissions(ownPoints)`; `useEffect(() => { controller.current?.setOwnSubmissions(ownPoints); }, [ownPoints]);`
  - `<figure data-own-points={ownPoints.length} …>`.
  - inspection 렌더: `items.map((item) => item.kind === 'win' ? 기존 버튼 : <Button key={`own:${item.point.submissionId}`} …>{row.openedYear}.{…} · 내 투찰 {item.point.rateText}% · {item.point.amountText ? `${item.point.amountText}원` : '금액 미확인'} · 회차 {row.attemptId}</Button>)`.
    `choose && items.length === 1` → `selection?.select(items[0].point.row.attemptId)`.
  - remount key(`revision`)에 own 관련 값을 넣지 않는다(주석으로 이유).

- [ ] **Step 7: 검사·typecheck·commit**
```bash
pnpm --filter @eatbid/web exec bun test src/app --timeout 30000
pnpm --filter @eatbid/web typecheck
git commit -am "feat(web): 흐름 차트가 custom series로 실제 내 투찰 점을 그리고 선택·범위를 유지한다"
```

---

### Task 7: `OwnBidProvider`와 사업자 선택·상태 문구·409 복구

**파일:** 신규 `.../_ui/own-bid/own-bid-context.tsx`, `.../_ui/own-bid/own-bid-controls.tsx`, `.../_ui/own-bid/own-bid-context.test.tsx`,
`apps/web/src/shared/lib/business-number-display.ts`; 수정 `.../_ui/evidence-tabs.tsx`, `.../page.tsx`,
`apps/web/src/app/(auth)/setup/_model/registered-business-view.ts`(helper import), `apps/web/src/api/account/index.ts`

**Interfaces:**
```ts
export type OwnBidStatus =
  | { readonly kind: 'signed-out' } | { readonly kind: 'checking' } | { readonly kind: 'auth-unavailable' }
  | { readonly kind: 'uninitialized' } | { readonly kind: 'no-businesses' } | { readonly kind: 'select-business' }
  | { readonly kind: 'history-not-ready' } | { readonly kind: 'loading' }
  | { readonly kind: 'observed'; readonly display: OwnDisplayModel } | { readonly kind: 'unobserved' }
  | { readonly kind: 'evidence-conflict' } | { readonly kind: 'build-changed' } | { readonly kind: 'error'; readonly retry: () => void };
export type OwnBidValue = { readonly status: OwnBidStatus; readonly businesses: readonly RegisteredBusiness[]; readonly selectedBusinessId: string | null; readonly select: (businessId: string) => void; readonly display: OwnDisplayModel | null };
export function OwnBidProvider(props: { organizationId: string | null; buildId: string | null; rows: readonly HistoryRow[]; children: ReactNode })
export function useOptionalOwnBid(): OwnBidValue | null
```

- [ ] **Step 1: 실패하는 provider 검사** — `use-account-session.test.tsx`와 같은 방식으로 `@/shell/auth/auth-client`와
`@/api/_transport/browser-request`를 `mock.module`로 대체한다(응답은 operationId로 분기: `getCurrentSession`·
`listMyBusinesses`·`findMyBidObservations`). 검사:
  1. `등록이 하나면 그 사업자로 바로 묻고 여럿이면 고르기 전까지 묻지 않는다`
  2. `계정이 바뀌면 이전 선택과 점을 비우고 이전 계정의 응답이 늦게 와도 새 화면에 닿지 않는다` — provider subject A→B 전환 후 A의 pending 응답 resolve → `display` null 유지.
  3. `revision이 없는 행이 하나라도 있으면 history-not-ready이고 요청하지 않는다`
  4. `409는 build-changed 상태이며 다른 오류는 재시도를 제공한다`
  5. `요청 회차는 첫 페이지의 개찰일 있는 행뿐이며 한 번의 요청이다`

- [ ] **Step 2: helper 이동** — `shared/lib/business-number-display.ts`에 `businessNumberDisplay`를 옮기고
`registered-business-view.ts`는 `export { businessNumberDisplay } from '@/shared/lib/business-number-display'`로 재수출(소비자 import 유지).

- [ ] **Step 3: provider 구현**
```tsx
/** @module 책임: 로그인 계정·등록 사업자·회차 이력 표본을 내 투찰 batch 조회 하나로 조립하고 선택 상태를 현재 principal 안에 가둔다. */
'use client';
export function OwnBidProvider({ organizationId, buildId, rows, children }) {
  const account = useAccountSession();
  const session = account.session;
  const scope = session?.state === 'active' ? { principalId: session.principalId, workspaceId: session.workspace.workspaceId } : null;
  const businessesQuery = useQuery({ ...accountQueries.businesses(scope ?? { principalId: '', workspaceId: '' }), enabled: scope !== null });
  const businesses = businessesQuery.data?.businesses ?? EMPTY;
  // 선택은 principal에 매인다. 계정이 바뀌면 같은 businessId라도 남의 등록이라 값이 자동으로 비워진다.
  const [choice, setChoice] = useState<{ principalId: string; businessId: string } | null>(null);
  const chosen = choice !== null && choice.principalId === scope?.principalId && businesses.some((b) => b.businessId === choice.businessId) ? choice.businessId : null;
  // 등록이 하나면 고르라고 요구하지 않는다. 여럿이면 기본값을 두지 않는다(인계 원문).
  const businessId = businesses.length === 1 ? businesses[0]!.businessId : chosen;
  const attempts = useMemo(() => rows.filter((row) => row.openedAt != null && row.revisionId !== null).map((row) => ({ attemptId: row.attemptId, revisionId: row.revisionId! })), [rows]);
  const historyReady = rows.length > 0 && rows.every((row) => row.revisionId !== null) && organizationId !== null && buildId !== null;
  const enabled = scope !== null && businessId !== null && historyReady && attempts.length > 0;
  const observations = useQuery({ ...accountQueries.bidObservations(scope ?? { principalId: '', workspaceId: '' }, { businessId: businessId ?? '', organizationId: organizationId ?? '', buildId: buildId ?? '', attempts }), enabled });
  const display = useMemo(() => observations.data?.supplier.kind === 'observed' ? buildOwnDisplayModel(rows, observations.data.supplier.attempts) : null, [observations.data, rows]);
  const status = deriveStatus({ account, scope, businessesQuery, businesses, businessId, historyReady, observations, display });
  const select = useCallback((next: string) => { if (scope) setChoice({ principalId: scope.principalId, businessId: next }); }, [scope]);
  const value = useMemo(() => ({ status, businesses, selectedBusinessId: businessId, select, display: status.kind === 'observed' ? display : null }), [...]);
  return <OwnBidContext.Provider value={value}>{children}</OwnBidContext.Provider>;
}
```
`deriveStatus`(같은 파일, 순수): `isAccountDependencyUnavailableError(account.error)` → auth-unavailable; pending → checking;
`unauthenticated` → signed-out; `uninitialized` → uninitialized; businesses pending → checking; 0개 → no-businesses;
`businessId === null` → select-business; `!historyReady || attempts.length === 0` → history-not-ready; observations pending → loading;
`isBidObservationsBuildChangedError(error)` → build-changed; error → `{ kind: 'error', retry: () => observations.refetch() }`;
data.supplier.kind → observed/unobserved/evidence-conflict. 300줄을 넘기면 `own-bid-status.ts`로 뺀다.
`display`는 `status.kind === 'observed'`일 때만 노출해 이전 응답이 새 상태에 남지 않게 한다.

- [ ] **Step 4: controls** — `_ui/own-bid/own-bid-controls.tsx`:
```tsx
/** @module 책임: 흐름 차트 위에서 내 투찰 사업자 선택과 조회 상태를 사용자 문장으로 말하고 build 전환에서 latest 전환·재시도를 제공한다. */
'use client';
export function OwnBidControls({ auctionId, search }: { readonly auctionId: string; readonly search: DecisionSearch }) {
  const ownBid = useOptionalOwnBid();
  const pathname = usePathname();   // Suspense 안에서만 읽는다(AccountHub와 같은 이유) → 이 컴포넌트를 evidence-tabs에서 <Suspense fallback={null}>로 감싼다.
  if (!ownBid) return null;
  ...
}
```
문구(사용자 언어만, 내부 상태 설명 없음):
| kind | 표시 |
|---|---|
| signed-out | `로그인하면 내 투찰을 볼 수 있어요` + `Google로 로그인` Link → `loginRouteWithReturn(pathname)` |
| checking / loading | `내 투찰 확인 중` (role=status) |
| auth-unavailable | `지금은 내 투찰을 확인할 수 없어요` |
| uninitialized / no-businesses | `사업자를 등록하면 내 투찰을 볼 수 있어요` + `내 사업자 설정` Link → `setupRouteWithReturn(pathname)` |
| select-business | `사업자를 고르면 내 투찰을 표시해요` + DropdownMenu(RadioGroup, 항목 `businessNumberDisplay`) aria-label `내 투찰 사업자 선택` |
| history-not-ready | `회차 이력을 아직 준비하지 못해 내 투찰을 표시할 수 없어요` |
| observed | `내 투찰 · 123-45-67890` + `ownSummaryText(summary)` |
| unobserved | `수집 원본에 아직 이 번호가 없어 표시할 기록이 없어요` |
| evidence-conflict | `이 번호가 서로 다른 두 업체를 가리켜 내 투찰을 판정할 수 없어요` |
| build-changed | `<OwnBidBuildRecovery auctionId search />` |
| error | `내 투찰을 불러오지 못했어요` + `다시 시도` 버튼(retry) |
등록이 둘 이상이면 observed 등 어느 상태에서도 dropdown이 남아 다른 사업자로 바꿀 수 있다(`data-slot='own-bid-business'`).
`OwnBidBuildRecovery`는 `HistoryBuildRecovery`와 같은 규칙: `historyRead !== 'latest'`면 `router.replace(latest 주소)` 한 번,
latest면 `다시 불러오기`(`router.refresh()`) 버튼. 두 컴포넌트가 같은 코드면 `history-build-recovery.tsx`의 `BuildRecovery`를
재사용한다(문장만 prop).

- [ ] **Step 5: 자리** — `evidence-tabs.tsx`의 `FlowBody`가 `ready`일 때 차트 위에
`<Suspense fallback={null}><OwnBidControls auctionId={auctionId} search={search} /></Suspense>`(FlowBody에 `auctionId`·`search` prop 추가).
`page.tsx`:
```tsx
  const history = data.history;
  const sample = history.state === 'ready' ? history.presentation : null;
  return (
    <OwnBidProvider organizationId={sample?.organizationId ?? null} buildId={sample?.buildId ?? null} rows={sample?.rows ?? []}>
      <DecisionScreen … />
    </OwnBidProvider>
  );
```
(`DecisionScreen`은 바꾸지 않으므로 기존 화면 검사가 그대로다.)

- [ ] **Step 6: 검사·typecheck·boundary·commit**
```bash
pnpm --filter @eatbid/web exec bun test src/app src/api src/shared --timeout 30000
pnpm --filter @eatbid/web typecheck
pnpm lint:web-boundaries
git commit -am "feat(web): 로그인 사업자의 실제 내 투찰을 결정 화면 차트에 연결한다"
```

---

### Task 8: 실제 DB·Nest·브라우저 인수

**파일:** 수정 `apps/server/fixtures/own-bid.fixture.ts`; 신규 `apps/server/fixtures/own-bid-web.fixture.ts`,
`apps/web/scripts/own-bid-e2e.ts`, `apps/web/playwright.own-bid.config.ts`, `apps/web/e2e/own-bid.spec.ts`; 수정 `apps/web/package.json`

- [ ] **Step 1: seed 함수 export** — `own-bid.fixture.ts`:
```ts
/** 어댑터·HTTP 검사와 브라우저 harness가 같은 사실 위에서 돌도록 seed를 함수로 빌려준다. */
export async function seedOwnBid(owner: ReturnType<typeof postgres>): Promise<void> {
  await owner.unsafe(identitySeed); await owner.unsafe(evidenceSeed); await owner.unsafe(auctionSeed);
  await owner.unsafe(bulkSeed); await owner.unsafe(rosterSeed); await owner.unsafe(martSeed);
}
export const ownBidDatabase = disposableDatabase({ task: "eat40-own-bid", migrationApplyCount: 1, seed: seedOwnBid });
```
`bulkAttemptKeys`, `BULK_ATTEMPT_COUNT`, `publishNextBuild`, `observeConflictingSupplier`, `NEXT_BUILD_ID`,
`TARGET_ORGANIZATION_ID`, `MY_SUPPLIER_PARTY_ID`는 이미 export다. 서버 검사 재실행: `bun test src/testing/own-bid-http.integration.test.ts src/modules/procurement --timeout 30000`.

- [ ] **Step 2: web fixture** — `own-bid-web.fixture.ts`. 브라우저가 차트를 그리려면 개찰일·낙찰값이 필요하고, 화면이
열 현재 공고가 필요하며, 겹친 제출과 다음 build의 같은 회차가 필요하다. 시각은 실행 시각 상대값이라 12개월 기본 기간에
항상 든다.
```ts
/** @module 책임: 브라우저 인수용 seed — own-bid seed 위에 개찰일·낙찰값·현재 공고·같은 날 겹친 내 제출·다음 build의 같은 회차를 얹는다. */
import type postgres from "postgres";
import { disposableDatabase } from "./disposable-database.fixture";
import { ACTIVE_BUILD_ID, BULK_ATTEMPT_COUNT, NEXT_BUILD_ID, TARGET_ORGANIZATION_ID, seedOwnBid } from "./own-bid.fixture";

/** 화면이 여는 공고. 회차 이력에서 자기 자신은 빠지므로 첫 페이지 60행이 전부 다른 회차가 된다. */
export const WEB_CURRENT_AUCTION_ID = 8110n;
/** 같은 날 같은 값(89.500)으로 두 회차에 제출한 경우다. 점이 완전히 겹친다. */
export const WEB_OVERLAP_ATTEMPTS = { first: 8201n, second: 8202n } as const;
const BULK_BASE = 8200;

const webSeed = `
  -- 현재 공고: 열린 회차, mart에는 없다.
  insert into ingest.raw_observation (observation_id, run_id, request_unit_id, source, endpoint, request_params, fetched_at, http_status, content_sha256)
  overriding system value values (6120, '00000000-0000-0000-0000-000000000040', 1401, 'eat', '/bid-detail', '{}', now(), 200, '${"c".repeat(64)}');
  insert into ingest.normalized_record (normalized_record_id, observation_id, record_type, source_entity_id, normalized_payload, parser_version, normalized_at)
  overriding system value values (5120, 6120, 'auction.v2', 'external-8110', '{}', 'eat-v3', now());
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id) overriding system value values (${WEB_CURRENT_AUCTION_ID}, 'eat', 'external-8110');
  insert into core.auction_revision (auction_revision_id, auction_attempt_id, normalized_record_id, observation_id, content_sha256, source_status, title, announced_at, deadline_at, opened_at, base_amount, currency, source_payload)
  overriding system value values (9110, ${WEB_CURRENT_AUCTION_ID}, 5120, 6120, '${"7".repeat(64)}', 'OPEN', '남산초 축산물 구매', now() - interval '1 day', now() + interval '1 day', now() + interval '1 day 3 hours', 2761700.00, 'KRW', '{}');
  insert into core.auction_organization (auction_revision_id, organization_id, role) values (9110, ${TARGET_ORGANIZATION_ID}, 'purchaser');

  -- 고정 회차: 개찰일을 최근으로, 하한율은 현재 공고에 조건이 없으므로 null로 맞춘다(historyFloorOf → unknown).
  update mart.org_round_summary set floor_rate = null where organization_id = ${TARGET_ORGANIZATION_ID};
  update mart.org_round_summary set opened_at = now() - interval '9 days', awarded_assessment_rate = null where auction_attempt_id = 8101;
  update mart.org_round_summary set opened_at = now() - interval '8 days', awarded_assessment_rate = 89.002, runner_up_assessment_rate = 89.003, list_count = 2, winner_supplier_party_id = 7702 where auction_attempt_id = 8102;
  update mart.org_round_summary set opened_at = now() - interval '7 days' where auction_attempt_id in (8104, 8105, 8107, 8108, 8109);
  -- 대량 회차: 30일 전부터 하루씩 뒤로. 낙찰값을 실어 선이 그려지게 한다.
  update mart.org_round_summary s set
    announced_at = now() - ((33 + (s.auction_attempt_id - ${BULK_BASE})) || ' days')::interval,
    opened_at = now() - ((30 + (s.auction_attempt_id - ${BULK_BASE})) || ' days')::interval,
    awarded_assessment_rate = 89.000 + ((s.auction_attempt_id - ${BULK_BASE}) % 7) * 0.111,
    list_count = 5
   where s.auction_attempt_id between ${BULK_BASE} and ${BULK_BASE + BULK_ATTEMPT_COUNT - 1};
  -- 겹친 제출: 8201·8202를 같은 날로 놓고 내 party 행을 같은 값으로 넣는다. 명단 블록 수와 행 수를 맞춘다.
  update mart.org_round_summary set opened_at = now() - interval '20 days', awarded_assessment_rate = null where auction_attempt_id = 8201;
  update mart.org_round_summary set opened_at = now() - interval '20 days', awarded_assessment_rate = 89.600, winner_supplier_party_id = 7702 where auction_attempt_id = 8202;
  update core.auction_revision set source_payload = '{"roster":{"submissions":[{}],"sourceRosterSize":1}}' where auction_revision_id = 9201;
  update core.auction_revision set source_payload = '{"roster":{"submissions":[{},{}],"sourceRosterSize":2}}' where auction_revision_id = 9202;
  insert into core.bid_submission (auction_revision_id, auction_attempt_id, opened_at, roster_ordinal, source_supplier_account_id, supplier_party_id, submitted_at, amount, effective_amount, currency, bid_rate, rank, source_status_code_value_id, observation_id)
  values (9201, 8201, now() - interval '20 days', 0, 7801, 7701, null, 2472000.00, 2472000.00, 'KRW', 89.500, null, 7201, 6201),
         (9202, 8202, now() - interval '20 days', 0, 7801, 7701, null, 2472000.00, 2472000.00, 'KRW', 89.500, 2, 7201, 6202),
         (9202, 8202, now() - interval '20 days', 1, 7802, 7702, null, 2474762.00, 2474762.00, 'KRW', 89.600, 1, 7202, 6202);
  -- 다음 build: 8101은 새 해석(9111, 내 행 없음), 나머지는 같은 revision을 그대로 복사한다.
  update mart.org_round_summary set opened_at = now() - interval '9 days' where build_id = ${NEXT_BUILD_ID} and auction_attempt_id = 8101;
  insert into mart.org_round_summary (build_id, auction_attempt_id, auction_revision_id, organization_id, item_code_value_id, item_label, announced_at, opened_at, floor_rate, award_method_code_value_id, base_amount, planned_amount, currency, awarded_assessment_rate, runner_up_assessment_rate, day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count, withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id, lineage_status, opened_month_kst)
  select ${NEXT_BUILD_ID}, auction_attempt_id, auction_revision_id, organization_id, item_code_value_id, item_label, announced_at, opened_at, floor_rate, award_method_code_value_id, base_amount, planned_amount, currency, awarded_assessment_rate, runner_up_assessment_rate, day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count, withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id, lineage_status, opened_month_kst
    from mart.org_round_summary where build_id = ${ACTIVE_BUILD_ID} and organization_id = ${TARGET_ORGANIZATION_ID} and auction_attempt_id <> 8101;
`;

export const ownBidWebDatabase = disposableDatabase({
  task: "eat40-own-bid-web",
  migrationApplyCount: 1,
  seed: async (owner) => { await seedOwnBid(owner); await owner.unsafe(webSeed); },
});

/** account.fixture의 `withAccountDatabase`와 같은 정리 확인 규칙이다. */
export async function withOwnBidWebDatabase<A>(work: Parameters<typeof ownBidWebDatabase.withDatabase<A>>[0]): Promise<A> { /* 동일 구조 */ }
```
`opened_month_kst`가 not null이면 update에서 함께 채운다(`(opened_at at time zone 'Asia/Seoul')::date` 첫날). 열 제약은
`packages/db/src/schema/mart` 또는 migration SQL에서 확인한다. seed가 틀리면 harness의 첫 smoke(아래)가 곧바로 알려준다.

- [ ] **Step 3: harness** — `apps/web/scripts/own-bid-e2e.ts`(`auth-e2e.ts`를 그대로 따르되):
  - DB: `withOwnBidWebDatabase`. 세션 둘: `own-first@example.com`, `own-second@example.com`.
  - `observeConflictingSupplier(owner)`를 Playwright 전에 실행.
  - Nest 4447, `CORS_ORIGINS: WEB_ORIGIN`, `BETTER_AUTH_URL: WEB_ORIGIN`.
  - **smoke:** Playwright 전에 `fetch(`${API_ORIGIN}${auctionV1Operations.find.buildPath({ path: { auctionId: '8110' } })}`)`가
    200이고 `organizations` 회차 이력(`limit=60&includeRevision=true&opened=only&floorRate=unknown&awardMethod=unknown&from=…&to=…`)이
    60행·`nextCursor !== null`인지 확인한다. 아니면 seed 오류를 그대로 던진다.
  - 제어 서버: `Bun.serve({ hostname: '127.0.0.1', port: 0, fetch })`, `POST /publish-next-build` → `publishNextBuild(owner)` → 204.
    child env `EATBID_E2E_CONTROL_ORIGIN`.
  - child env: `EATBID_E2E_SESSION_COOKIE_FIRST/SECOND`, `EATBID_E2E_API_ORIGIN`, `EATBID_E2E_OBSERVED_BUSINESS_NUMBER=9000000016`,
    `EATBID_E2E_UNOBSERVED_BUSINESS_NUMBER=9000000020`, `EATBID_E2E_CONFLICTED_BUSINESS_NUMBER=9000000035`, `EATBID_E2E_AUCTION_ID=8110`.
  - `pnpm exec playwright test --config playwright.own-bid.config.ts`. 종료 순서·정리는 auth-e2e와 같다.
  - `playwright.own-bid.config.ts`는 `playwright.auth.config.ts`와 같고 `testMatch: 'own-bid.spec.ts'`, `outputDir: 'test-results/own-bid'`.
  - `package.json`: `"pretest:e2e:own-bid": "<pretest:e2e:auth와 동일>"`, `"test:e2e:own-bid": "cd ../server && bun ../web/scripts/own-bid-e2e.ts"`.

- [ ] **Step 4: spec** — `apps/web/e2e/own-bid.spec.ts`(serial). helper: `signedInContext`(auth 스펙과 같음),
`registerViaApi(context, number)` = `request.post(initialization)` → `request.post(businesses, { headers: { origin: WEB_ORIGIN }, data: { businessNumber } })`,
`openFlow(page)` = `goto(`/auctions/8110?view=흐름`)` → `[data-slot="flow-canvas"] canvas` 대기, `ownPosts(page)` = `page.on('request')`로
`findMyBidObservations` 경로 POST 기록(본문 JSON 파싱).
  1. `미로그인은 로그인 안내만 보고 내 투찰을 묻지 않는다` — 게스트 context, 문구·링크 `href` `/login?next=%2Fauctions%2F8110%3Fview%3D…`, POST 0회, `figure[data-own-points]=0`.
  2. `등록이 여럿이면 고르기 전까지 묻지 않고 고르면 첫 페이지 60회차를 한 번에 묻는다` — 첫 계정: 3개 등록 → flow → dropdown 열어 관측 번호 선택 → POST 정확히 1회, body `attempts.length === 60`, `buildId === '601'`, `organizationId === '41'`; 상태 문구 `내 투찰 4건` 포함; `data-own-points=4`.
  3. `사업자를 바꿔도 같은 캔버스와 확대 범위를 유지한다` — `비율 축 확대` 클릭 → `data-price-range` 읽기 → 미관측 번호 선택 → 문구 `아직 이 번호가 없어` → `data-own-points=0` → range 동일 → 관측 번호로 복귀 → 4, range 동일, canvas ElementHandle 동일(`evaluate` 로 `data-canvas-id`를 최초에 심어 비교).
  4. `증거가 갈린 번호는 판정하지 않는다고 말한다` — 충돌 번호 선택 → 문구.
  5. `같은 날 같은 값의 두 제출은 후보로 나뉘고 고른 회차의 revision으로 기록을 연다` — 관측 번호. 캔버스 폭을 40단계로 `mouse.move`하며
     후보 버튼 `/내 투찰 89\.500%/`가 2개 보이는 x를 찾는다 → `회차 8202` 버튼 클릭 → `region 선택 회차 참여 기록` 표시, roster 요청 URL에 `revisionId=9202`, 표 행 2개.
  6. `낙찰이 없는 회차의 내 점을 캔버스에서 눌러 같은 회차·revision 기록을 열고 자리표시자 금액을 보이지 않는다` — 8101(own 2점: 101.975·89.001).
     같은 sweep으로 `회차 8101` 후보가 보이는 x를 찾고, 그 x에서 캔버스 세로 방향 4px 간격 `mouse.click` — 패널이 열리면 중단. 요청 URL `revisionId=9101`;
     패널 text에 `금액 미확인`은 후보 버튼에서, 표에는 `10,000,000,043,768` 없음. 후보 버튼 문구 `101.975%` 존재.
  7. `로그아웃하면 점과 문구가 사라지고 다른 계정은 앞 계정의 점을 보지 못한다` — 계정 메뉴 로그아웃 → `data-own-points=0`, 로그인 안내. 둘째 계정 context: 미관측 번호만 등록 → flow → 문구 `아직 이 번호가 없어`, `data-own-points=0`, 첫 계정 문구 `내 투찰 4건` 없음.
  8. `자료 기준이 바뀌면 latest로 한 번 옮겨 같은 새 기준의 표와 점을 다시 그린다` — 첫 계정 page: `request.post(control + '/publish-next-build')` → `page.reload()` → URL이 `historyRead=latest`를 포함할 때까지 대기 → POST body `buildId === '602'` 관측 → 문구 `내 투찰 2건`(8101은 새 해석에서 명단에 없음), `data-own-points=2`; `page.url()` 전환이 한 번뿐인지 `framenavigated` 카운트로 확인.
  캔버스 존재만으로 점 검증을 대신하지 않는다: 2·3·6·8은 `data-own-points`와 실제 POST 본문, 5·6은 실제 roster 요청 URL로 판정한다.

- [ ] **Step 5: 실행**
```bash
pnpm --filter @eatbid/web test:e2e:own-bid
```
실패하면 harness step 로그로 단계를 가리고 seed·화면을 고친다. 통과 뒤 `test-results/own-bid/*.png`(2·5·8 장면 캡처)를 남긴다.

- [ ] **Step 6: commit** — `test(web): 실제 DB·Nest·브라우저로 내 투찰 점·선택·전환·build 복구를 검사한다`

---

### Task 9: gate·advisory·문서·인계

- [ ] `pnpm --filter @eatbid/web test`, `typecheck`, 변경 파일 `oxlint --deny-warnings`, `pnpm --filter @eatbid/web build`
- [ ] `pnpm --filter @eatbid/server test`(Task 0·8 fixture 변경 회귀), `pnpm quality:check`, `pnpm architecture:check`
- [ ] `pnpm --filter @eatbid/web test:e2e:decision`, `test:e2e:auth`(회귀), `test:e2e:own-bid`
- [ ] 결정적 gate 뒤 `pnpm review:ai -- --base <통합 base commit>`; finding은 근거를 보고 판정하고 자동 수정하지 않는다.
- [ ] 1440·1280·1024·768 폭에서 own 컨트롤 줄이 문서를 가로로 밀지 않는지 `decision-screen.spec.ts` 폭 검사로 확인(컨트롤이 흐름 탭에 있으므로 자동 포함).
- [ ] `docs/product/notice-design-fidelity.md` 현황 표에 `내 투찰` 행 추가(시안 대조는 fixture 고정 캡처가 없으면 미수행으로 남긴다).
- [ ] 이 문서 끝에 `## 실행 결과` 절: commit, 실행한 검사와 수, 미검증(실제 Google 왕복, 시안 대조), 남은 차이.
- [ ] Linear EAT-40 코멘트: branch/worktree · 기준 commit · owned paths · 검증/미검증 · 하지 않은 외부 작업. `pnpm workflow:release`.

## 실행 결과 — 2026-09-09

계획의 Task 0~8을 같은 branch에서 순서대로 마쳤다. 계획과 달라진 점과 인수 중 발견한 결함은 아래에 적는다.

- 통합 base: `codex/eat-40-own-bid` `645dbf3`에 dev `81be4b6`과 계정 기반 `132b8fc`를 merge했다(충돌 없음).
  통합 base의 서버 검사 2개가 Vary 대소문자 때문에 깨져 Task 0에서 검사만 고쳤다(`8a40a25`).
- Task 1·2·3: `76d08f6` `2f1486c` `5ff9080`. uncached entry는 별도 transport adapter 대신 같은 `serverRequest`를
  `use cache` 밖에서 부른다 — resource `server.ts`는 승인된 adapter 하나만 exact import한다는 boundary 규칙
  때문이며, cacheComponents 아래에서 `use cache` 밖 fetch는 캐시되지 않는다.
- Task 4·5: `a8fa658`. 금액 문자열 helper는 client-safe한 `bid-rate.ts`로 옮겼다(`attempt-history.ts`는 Temporal을
  쓰므로 client 모듈이 값을 import할 수 없다).
- Task 6·7: `22cfcb9` `9f2e464`. 계획대로 `page.tsx`가 provider로 감싸 `DecisionScreen`과 기존 검사를 그대로 뒀다.
- 인수 중 발견해 고친 결함(`120628b` `5c877e9`): (1) 한 등록의 증거가 갈리면 등록 목록 전체가 503 — 목록 계약
  `RegisteredBusinessSupplier`에 `evidence-conflict`를 additive로 더하고 내부 record를 세 상태 값으로 바꿨다.
  (2) 캔버스 클릭 거리 계산이 데이터 없는 참조 계열 좌표를 써서 내 점만 있는 날은 클릭이 닿지 않았다.
  (3) Base UI radio 항목은 고른 뒤에도 메뉴를 열어 두고, 그룹 라벨은 RadioGroup 밖에서 예외를 낸다.
- Task 8(`5626c03`): mart 행은 build가 building일 때만 쓸 수 있어 web seed를 `seedOwnBid`의 `beforeActivation`
  hook으로 옮겼고, 증거가 갈린 번호는 등록 뒤에 갈라야 하므로 첫째 계정 등록을 harness가 실제 계약으로 마친 뒤
  `observeConflictingSupplier`를 실행한다. 명단 행은 revision의 개찰 시각과 정확히 같은 `opened_at`에서만
  세므로 겹친 제출 seed는 세 자리에 같은 시각을 쓴다.

검증(모두 실제 실행):

| 검사 | 결과 |
|---|---|
| `pnpm --filter @eatbid/web test` | 503 pass |
| `pnpm --filter @eatbid/web typecheck` | 통과 |
| `pnpm --filter @eatbid/web test:e2e:own-bid` (실제 DB·Nest·Chromium) | 8 passed |
| `pnpm --filter @eatbid/web test:e2e:decision` (정적 fixture) | 35 passed |
| server 계정·own-bid·통합 검사 | 22 pass, 72 pass(procurement 포함) |
| `pnpm architecture:check` (quality·boundary·endpoint·contracts·python 포함) | 통과 |

미검증: 실제 Google OAuth 왕복(dev 설정 위치 없음), 고정 fixture 시안 대조(시안에 이 계열이 없음), 운영 배포.

## 자기 검토

- 인계 원문 대조: revision opt-in(Task 1·2), roster에 revision 전달(2), batch 하나·N+1 금지·60 vs 200(4·7), 사업자 선택·URL 금지·principal 한정(7),
  범례·색·형태 구별(6), exact 비율·100 초과·금액 미확인(5), 상태 구분 문구(7), 겹친 제출·submissionId key·AttemptSelectionProvider(6),
  custom series·conflation·엔진 유지(6), 낙찰 null도 엔진 동작(6), remount key·fitContent 금지·전체 값(6), 취소·폐기 정책 공유(4·7),
  build·asOf 고정·409·prefix 폐기(1), `historyRead=latest`·한 번만 자동 전환·늦은 응답 차단(3·7), 인수 목록 8건(8).
- 이름 일관성: `HistoryRow.revisionId`, `OrganizationAttemptsRead`, `listOrganizationAuctionAttemptsFromServerLatest`,
  `buildDecisionHistoryReadRoute`, `accountQueries.bidObservations`, `buildOwnDisplayModel`, `setOwnSubmissions`, `useOptionalOwnBid`,
  `OwnBidControls`, `data-own-points`, `data-price-range`가 task 사이에서 같은 철자다.
- 300줄: `create-flow-chart.ts`·`own-bid-context.tsx`·`account-resource-error.ts`·`own-bid.spec.ts`가 넘길 수 있는 후보이며 각 task에 분리 지점을 적었다.
