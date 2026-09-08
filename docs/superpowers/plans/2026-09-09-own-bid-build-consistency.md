# 한 회차 이력 응답의 build 정합성 — 2026-09-09 (EAT-40 선행 단위)

## 문제

`DrizzleOrganizationAttemptReader.listAttempts`는 한 응답을 만드는 동안 활성 build를 세 번 따로
물었다. cursor anchor 조회, 페이지 조회, 표본 수 조회가 각각 `activeMartBuildId('org_round_summary')`
하위 질의를 다시 실행하고, 계보는 `readActiveMartBuildLineage`가 또 한 번 읽었다.

mart 발행은 이전 active를 `superseded`로, 새 `verified`를 `active`로 바꾸는 한 트랜잭션이다
(ADR 0034). 그 전환이 호출 도중에 일어나면 네 조회가 서로 다른 build를 본다. 행은 A인데 표본 수는
B, 계보 meta는 B, cursor는 A에만 있어 "이력 끝"으로 위장하는 응답이 만들어진다.

EAT-40의 own bid 점을 같은 명단 revision에 붙이기 전에 이 응답 하나의 기준부터 일치해야 한다.
기준이 흔들리는 표에 사용자의 투찰점을 얹으면 어느 build의 회차에 찍힌 점인지 재현할 수 없다.

## 범위

- 이번에 닫는 것: 단일 응답(HTTP 한 요청) 안의 원자적 build 기준.
- 이번에 하지 않는 것: 여러 HTTP 페이지에 걸친 build 고정, 공개 history revision 필드, 개인
  batch/API, auth·웹·계정. own point 구현은 EAT-47 계약 통합 뒤 같은 worktree에서 이어간다.
- 공개 계약 응답 형태를 바꾸지 않는다. DB schema·manifest·lock·web은 건드리지 않는다.

## 결정

- `listAttempts`는 시작에서 `readActiveMartBuildLineage`를 **한 번만** 실행해 build 하나를 고른다.
  그 build ID를 anchor·페이지·표본 수 조회에 명시적 인자로 넘기고 SQL은 활성 build를 다시 묻지
  않는다. meta 계보도 같은 조회에서 나온 그 build다.
- 활성 build가 없으면 읽을 파생물이 없다. 빈 페이지(계보 null)이며 cursor가 있으면
  `cursor-not-found`다. 기존 동작과 같다.
- 고른 build가 응답 도중 `superseded`가 되어도 행은 `retain_until` 전까지 남는다(ADR 0034).
  새 캐시·락·transaction framework를 만들지 않고 이 보존 정책을 그대로 쓴다.
- 새 아키텍처 결정이 필요 없다. ADR 0034가 이미 "읽기 경로는 활성 build 하나를 조인한다"를
  정했고, 이 변경은 그 불변식을 어긴 어댑터를 수리하는 것이다.

## 검증

- [x] 새 통합 검사 `organization-attempt-build.integration.test.ts`가 실제 disposable PostgreSQL
      migration harness 위에서 A→B 원자적 발행을 호출 도중에 끼워 넣는다.
- [x] 첫 조회 뒤 발행을 끼운 뒤 행·표본 수·cursor 유효성·계보가 전부 A임을 확인한다.
- [x] 활성 build 없음, 다른 기관 cursor, 같은 조건 필터 밖 cursor, 발행 뒤 새 요청이 B임을 확인한다.
- [x] 수정 전 같은 검사가 실패하는 것을 먼저 확인한다.
- [x] server 단위·통합 검사, typecheck, architecture, quality gate를 실행한다.
- [ ] 결정적 gate 뒤 canonical `pnpm review:ai -- --base be1e52c --provider auto`를 실행한다.

## 증거

수정 전 새 통합 검사를 실제 disposable PostgreSQL에서 먼저 돌려 두 결함을 각각 재현했다.

cursor 없는 요청은 행이 A(105·103·102)인데 표본 수가 B의 것이었다.

```
error: expect(received).toBe(expected)
Expected: 4
Received: 2
```

cursor 있는 요청은 anchor를 A에서 찾고 페이지를 B에서 읽어 "이력 끝"으로 위장했다. B에는 103이
없어 keyset 하위 질의가 비교할 행을 찾지 못하고 빈 목록이 됐다.

```
error: expect(received).toEqual(expected)
- [ 102n, 101n, ]
+ []
```

수정 뒤 같은 검사가 통과한다. 아래 gate를 좁은 것부터 실행했고 전부 통과했다.

| 검사 | 결과 |
| --- | --- |
| `bun test src/testing/organization-attempt-build.integration.test.ts` | 2 pass, 22 expect |
| `bun test src/testing/organization-attempts.integration.test.ts` | 1 pass, 40 expect |
| `bun test src/testing/organization-cohort … organization-observed-rates …` | 2 pass, 43 expect |
| `bun test src/modules/procurement` | 66 pass |
| `tsc -p apps/server/tsconfig.build.json --noEmit` | 오류 없음 |
| `pnpm --filter @eatbid/server test` | 214 pass, 48 files |
| `pnpm quality:check` | 통과 |
| `pnpm --filter @eatbid/server architecture:check` | 0 violations |
| `node tools/architecture/check-semantic-values.mjs` | 통과 |

## 한계

- 이 변경은 응답 하나의 기준만 고정한다. 사용자가 다음 페이지를 요청하는 사이에 발행이 일어나면
  두 번째 페이지는 새 build를 읽는다. 페이지 사이 build 고정은 공개 계약에 build를 되싣는 후속
  범위이며 여기서 구현하지 않았다.
- `retain_until`이 지난 build를 회수하는 단계가 응답 도중에 돌면 고정한 build의 행이 사라질 수
  있다. 회수 단계는 아직 없고 보존 창은 ADR 0034가 소유한다.
