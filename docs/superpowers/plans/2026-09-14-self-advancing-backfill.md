---
id: PLAN-BACKFILL-SELF-ADVANCING-2026-09-14
status: plan
canonical_for: none
last_reviewed: 2026-09-14
review_trigger: backfill-scheduling-change
---

# 백필을 스스로 전진하게 만드는 구현 순서 (2026-09-14, EAT-209)

결정은 [ADR 0052](../../adr/0052-backfill-progress-recovery-and-advance.md)가 소유한다. 이 문서는 그
결정을 어떤 순서로, 어디에 만드는지만 적는다. 상태의 원천이 아니다.

## 0. 지금 사실

- `bid-detail` 요청 `planned` 50,337건 가운데 33,464건이 실패한 릴리스 11개에 묶여 있다.
- 목록 창은 전부 `captured`다. 창 정보는 `ingest.request_unit.request_params`의
  `P_BID_BGNG_DT`·`P_BID_END_DT`에 있고 `ingest.source_release_run`으로 릴리스에 이어진다.
- 진도를 가리키는 행은 없다.

## 1단계 — 커버리지를 하나의 정의로 만든다

**무엇.** `ingest` view 하나. 이름은 `backfill_coverage`. 한 행이 한 창이다.

| 열 | 뜻 |
|---|---|
| `window_start`, `window_end` | 목록 요청이 쓴 날짜 창 |
| `list_pages`, `list_captured` | 그 창의 목록 요청 수와 그중 captured |
| `detail_total`, `detail_captured`, `detail_planned` | 그 창이 발견한 상세 수와 상태별 |
| `detail_stranded` | `planned`이면서 그 run의 릴리스가 `failed`인 수 |
| `sealed` | 그 창을 덮은 릴리스 가운데 `sealed`가 있고 그 릴리스의 상세가 전부 captured인가 |

**어디.** `packages/db/src/schema/ingest/`에 Drizzle view로 선언하고 migration을 커밋한다. DDL 작성자는
Drizzle 하나다(AGENTS 10항).

**왜 view인가.** dataplane의 전진 판단과 Grafana가 같은 정의를 읽어야 한다. 같은 SQL을 두 곳에 적으면
한쪽만 고쳐지는 날이 온다(ADR 0052 결정 2).

**검증.** disposable PostgreSQL에 migration을 적용하고, 창 하나를 손으로 만든 세 상태(전부 captured,
일부 planned, 릴리스 failed)에서 `sealed`와 `detail_stranded`가 각각 무엇이 되는지 고정한다.

## 2단계 — 버려진 대기열을 아이디로 이어받는다

**무엇.** `discover`에 입력이 목록이 아니라 아이디 집합인 경로를 더한다. 새 명령이 아니라 같은 명령의
다른 입력으로 두어 릴리스·run·봉인 경계가 하나로 남게 한다.

**경계.** 실패한 릴리스는 손대지 않는다. 새 릴리스가 그 아이디들을 자기 membership으로 선언하고
`expected_count`는 이어받은 아이디 수다. 그래야 `expected_count == published_count`가 새 릴리스
안에서 참이 된다(ADR 0014·0015).

**입력을 어디서 얻나.** 1단계 view가 아니다. view는 창 단위 요약이고 여기서는 아이디가 필요하다.
`request_unit`에서 `endpoint = 'bid-detail'`, `status = 'planned'`, 그 run의 릴리스가 `failed`인 행의
`request_params->>'ELCTRN_BID_ID'`를 읽는다. 읽기는 dataplane repository가 소유한다.

**한 번에 얼마나.** 33,464건을 한 릴리스에 담지 않는다. 창 하나가 보통 16,000건 규모이므로 이어받기도
같은 자리 수로 나눈다. 나누는 단위는 원래 창이다 — 그 창의 stranded 아이디만 모아 한 릴리스로 만든다.
그러면 view의 `sealed`가 창 단위로 참이 되고 진도가 창 단위로 전진한다.

**검증.** 통합 테스트에서 실패한 릴리스와 그 `planned` 상세를 만든 뒤 이어받기를 돌려, 새 릴리스가
같은 아이디를 자기 membership으로 갖고 봉인되며 옛 릴리스는 `failed`로 남는 것을 본다.

## 3단계 — 전진을 예약으로 옮긴다

**무엇.** CronWorkflow 하나. `eatbid-backfill-advance`.

**판단.** 매 실행이 1단계 view를 읽고 이 순서로 하나를 고른다.

1. `detail_stranded > 0`인 창이 있으면 그중 가장 최근 창을 이어받는다(2단계 경로).
2. 없으면 floor date까지의 창 가운데 `sealed`가 거짓인 가장 최근 창을 돌린다(지금 경로).
3. 둘 다 없으면 아무것도 제출하지 않고 정상 종료한다.

최근 것부터 가는 이유는 사용자가 보는 화면이 최근을 먼저 쓰기 때문이다. 사장님 투찰 관측이 08-06에서
멈춘 것이 그 증거다.

**동시성.** `concurrencyPolicy: Forbid`. 자물쇠는 `eatbid-source-backfill`이고 예약 수집의
`eatbid-source-live`와 갈라져 있어 같은 대기열에 서지 않는다(EAT-164). 백필을 둘 돌리지 않는 규율이
manifest로 내려온다.

**범위.** floor date를 CronWorkflow 파라미터로 선언한다. 그 커밋이 운영자 승인이다(ADR 0052 결정 5).

**주기.** 백필 한 창이 며칠 걸리므로 짧을 이유가 없다. 시간당 한 번으로 시작하고 `Forbid`가 겹침을
막는다. 실측 뒤 조정한다.

**검증.** `infra/tests`가 이 CronWorkflow의 자물쇠 key·동시성·floor 파라미터를 단언한다. 클러스터에서
한 회차가 실제로 이어받기를 제출하는 것을 evidence로 남긴다.

## 4단계 — 기대와 화면이 같은 사실을 읽는다

- ADR 0046 결정 5의 기대에 "이어받을 것이 남아 있는데 전진이 멈췄다"를 더할지 판단한다. 1단계 view가
  이미 그 답을 갖고 있다.
- `planned` 나이 기대의 임계를 이어받기 실행 중의 정상 상태와 갈라 놓는다. 이어받기가 릴리스를 여니
  그 자체가 위반으로 보이면 안 된다.
- 크롤러 대시보드(EAT-174)의 첫 화면은 1단계 view다. 창별 커버리지 표가 그대로 화면이 된다.

## 하지 않는 것

- 아이디를 발견 축으로 쓰는 것(ADR 0052 결정 1).
- 커서를 테이블에 저장하는 것(결정 2).
- 실패한 릴리스를 되살리는 것(결정 3).
- 동시성 상향. EAT-180이 소유한다. 이 계획은 전진을 자동으로 만들 뿐 빠르게 만들지 않는다.

## 순서를 이렇게 잡은 이유

1단계가 먼저인 이유는 2·3·4단계와 화면이 전부 그것을 읽기 때문이다. 2단계가 3단계보다 먼저인 이유는
이어받기가 목록 호출 0으로 33,464건을 되찾는 가장 싼 경로이고, 그것을 먼저 비워야 3단계의 판단이
단순해지기 때문이다.
