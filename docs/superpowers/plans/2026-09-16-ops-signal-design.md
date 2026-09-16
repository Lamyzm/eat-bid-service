# 운영 신호 설계 — 미해결이 조용해지지 않고, 사람과 AI가 같은 것을 읽는다 (2026-09-16)

> 상태: 초안, 사장님 검토 대기. 이 문서는 "무엇을 왜"를 정한다. 단계별 실행 계획은 각 결정이 승인된 뒤
> 별도 plan으로 쓴다. 근거는 2026-09-16 하루의 실측(EAT-235·239·240)과 그 뒤의 네 차례 검토다.

## 0. 이 설계가 답하는 질문

사장님의 요구는 하나다. **각 서비스 상태·크롤러 진척도·실패 원인을 사람도 보고 AI도 조회하는 구조.**

그런데 오늘 하루가 보여준 것은, 그 화면을 먹일 신호 자체에 구멍이 있다는 사실이다. 화면을 먼저 만들면
화면이 거짓말을 한다. 그래서 이 설계는 네 층으로 순서를 세운다.

1. **안전** — 알림이 스스로 거짓 안심을 만들지 않고, 실패한 입력을 외부에 무한 재요청하지 않는다.
2. **신호** — 미해결이 조용해지지 않는다. 열린 위반은 나이를 먹고, 나이는 다시 울린다.
3. **가시성** — 그 신호를 사람이 Grafana에서, AI가 SELECT 한 줄로 같은 표에서 읽는다.
4. **진입점** — 다음 세션의 AI가 오늘 저처럼 스키마를 다섯 번 틀리지 않는다.

## 1. 오늘의 사실 (실측)

| 사실 | 근거 |
|---|---|
| 3월 창이 06:20 KST부터 매시 16,469건을 다시 받아 같은 자리에서 죽었고, 사람이 알아챈 것은 09:50경 | EAT-235, `ingest.publication` failed 3건 |
| `cron-workflow` 기대가 첫 회차에 울렸으나 "해소될 때까지 반복하지 않는다" 규칙으로 침묵 | ADR 0046 결정 6 |
| `main`이 9월 11일부터 16일까지 빨간 채로 v0.1.33~36을 냈고 `ci-main-green` 위반은 열린 채 억제됨 | 자동 issue #4·5·7·9·47, R2 상태 문서 |
| 기대 질의가 예외를 내면 그 기대의 기존 위반이 **해소로 판정**되어 "해소됨"이 나가고 `first_seen_at`이 초기화됨 | `monitoring/expectations.py` `evaluate` + `state.py` `diff_violations` 코드 확인 |
| 열린 위반 목록은 R2 JSON에만 있어 Grafana(PostgreSQL datasource)도 AI(psql)도 읽지 못함 | `monitoring/store.py`, 오늘 replay 파드에 boto3로 들어가 읽음 |
| 진도의 진실 `ingest.backfill_coverage`는 어느 화면에도 없고 대시보드는 미완 창 **개수**만 보임 | `monitoring-round.json` 패널 9개 전부 회차 지표 |
| 어제 올린 OpenObserve·fluent-bit은 사고 진단에 한 번도 쓰이지 않았고 run→로그 다리는 건너 본 적 없음 | 오늘 진단은 전부 psql·kubectl |
| 새 기대를 운영 데이터에 미리 걸어 보지 않아 하루 창 오탐이 배포 뒤에 드러나 릴리스를 한 번 더 냄 | EAT-240 |
| 크롤러 실행 안 재시도(`retryStrategy`)와 다음 정시 실행은 별개라 "3회 제한"으로는 매시 재요청을 못 막음 | Argo CronWorkflow 동작, 2차 검토 문서 |

## 2. 원칙 (CTO 결정)

- **사람 한 명이 텔레그램을 보는 조직**이 설계 입력이다. 당번을 도는 팀 전제의 알림 설계를 버린다.
- **12GB 단일 노드**가 비용 상한이다. 새 감시 스택(Prometheus·Alertmanager·Loki·Workflow Archive)을 들이지 않는다.
  지금 있는 PostgreSQL·Grafana·OpenObserve·Better Stack으로 전부 한다.
- **진실은 하나의 주인이 갖는다**는 원칙은 유지하되 경계를 하나 더 긋는다. **진도는 파생(뷰), 결정은 저장(표).**
  "어디까지 됐나"는 사실에서 다시 계산하고, "무엇을 하지 않기로 했나"는 적어 둔다.
- **관측하지 못한 것은 상태를 바꾸지 않는다.** 검사가 실패하면 모른다고 적는다. 해소로 적지 않는다(AGENTS 3항의 `unknown`).
- **화면보다 신호가 먼저다.** 1·2층이 끝나기 전에 3층을 만들지 않는다.
- **한 사고를 끝까지 관통하는 것으로 검증한다.** 3월 창 사고가 다시 나면 아래 §6이 그대로 일어나야 한다.

## 3. 결정

### D1. ADR 0046 결정 6을 두 문장으로 쪼갠다

지금 문장: "같은 창에서 생긴 위반은 묶어서 한 번 보내고 해소될 때까지 반복하지 않는다."

- 앞부분(한 회차의 여러 위반을 한 통으로)은 유지한다. 한 사고가 세 통으로 쪼개지면 셋인지 하나인지 모른다.
- 뒷부분(미해결이어도 다시 보내지 않는다)은 폐기한다. 대신 **심각도별 재알림 간격**과 **하루 한 번 요약**을 둔다.

| 심각도 | 어떤 기대 | 재알림 |
|---|---|---|
| critical | 실시간 수집 중단(`capture-freshness`), 노드·Application(server/web), poll-open 회차 실패, 백업 신선도 | 60분마다 미해결 재알림 |
| normal | 백필 진행·발행 실패 창·planned 나이·main CI·전진 회차 실패 | 09:03 KST 요약에만. 7일 넘으면 매일 개별 |

숫자는 시작값이며 2주 뒤 `monitoring.notification`에서 실제 통 수를 보고 조정한다. 요약 한 통의 형식은
"열린 것 N개, 가장 오래된 것 X일째(키)". 오늘의 5일 방치는 이 한 통으로 1일이 된다.

### D2. 감시 상태의 기준을 PostgreSQL `monitoring`으로 옮긴다 (ADR 0046 일부 대체)

R2 JSON을 둔 판단 자체는 틀리지 않았다(감시 상태는 raw도 업무 사실도 아니다). 옮기는 이유는 순수성이 아니라
**조회 가능성**이다. Grafana와 AI가 같은 표를 읽어야 하고, 나이·이력·재알림 판정이 같은 표에서 나야 한다.

```
monitoring.violation
  violation_id      bigint identity
  violation_key     text            -- 기대 key + 행 key (지금과 같음)
  expectation_key   text
  severity          text            -- critical | normal
  title, detail, runbook  text
  first_seen_at     timestamptz
  last_seen_at      timestamptz     -- 이번 회차에 실제로 관측된 마지막 시각
  observation       text            -- observed | unobserved (D3)
  resolved_at       timestamptz null
  last_notified_at  timestamptz null
  unique (violation_key) where resolved_at is null

monitoring.notification
  notification_id   bigint identity
  violation_id      bigint null     -- 요약은 null
  kind              text            -- opened | repeat | resolved | digest (평가 실패는 그 자체가 위반 행이다)
  sent_at           timestamptz
  ok                boolean
  error             text null
```

- 해소된 행은 지우지 않는다. 이력이 곧 "이 기대가 얼마나 자주 어떻게 깨지나"의 근거다.
- 전송 실패도 행으로 남는다. 알림이 안 간 상태가 정상으로 보이면 안 된다.
- R2 문서는 첫 회차에 한 번 읽어 **열린 항목의 `first_seen_at`만** 이관한다. 모르는 과거는 만들지 않는다. 그 뒤 R2 쓰기는 멈춘다.
- `monitoring.round`는 그대로 둔다. `violations_open`은 이 표에서 파생되지만 회차 행의 자기 기술로 남긴다.
- DDL은 Drizzle 마이그레이션 하나다. `eatbid_dataplane`은 이미 `monitoring.round`에 쓰므로 같은 권한 경로다.
  `eatbid_grafana`는 `monitoring` SELECT를 이미 갖는다.

### D3. 관측하지 못한 기대는 해소하지 않는다

`evaluate`가 어떤 기대에서 `check-failed`를 내면, 그 기대에 속한 **열린 위반은 전부 `observation = unobserved`로
유지**하고 `last_seen_at`을 건드리지 않으며 해소 알림을 내지 않는다. 클러스터 probe도 경로별로 같다.
회복된 회차에 다시 관측되면 `observed`로 돌아오고 `first_seen_at`은 그대로다.

이건 D2보다 먼저 나갈 수 있는 순수 로직 수정이다. 표가 없어도 지금 R2 문서 구조 안에서 고칠 수 있으므로
**첫 릴리스에 단독으로** 실린다. 잘못된 이력을 표에 쌓기 시작하기 전에 고쳐야 한다.

### D4. 소스 보류 표 — cron 경계를 넘어 살아 있는 "하지 않기로 한 결정" (ADR 0055; 구현은 `ingest.source_hold`, 소스 단위)

오늘 넣은 "발행 실패 창은 전진이 건너뛴다"는 뷰에서 파생되는 자동 규칙이고 그대로 둔다. 파생될 수 없는
결정이 따로 있다: **소스가 우리를 차단하는 것으로 의심될 때 언제까지 멈추는가.** 이건 진도가 아니라 결정이다.

```
ingest.window_hold
  hold_id        bigint identity
  source         text                 -- 'eat'
  window_start   text null            -- null이면 소스 전체
  window_end     text null
  reason         text                 -- source-backoff | operator
  detail         text
  held_at        timestamptz
  held_by        text                 -- run_id 또는 사람
  release_after  timestamptz null     -- 이 시각이 지나면 자동 해제
  released_at    timestamptz null
```

- `capture`가 차단 의심 응답(429, 403, 로그인 HTML, 연속 timeout 등 소스 어댑터가 정의)을 보면 소스 전체 보류를
  지수 backoff로 적는다. 시작 15분, 최대 24시간. 보류가 열리면 critical 위반이 열린다.
- `discover`·`discover-backfill`·`poll-open`은 열린 소스 보류가 있으면 **시작하지 않고 Skipped**로 끝난다.
  다음 정시 실행이 와도 같다. 이것이 "3회 제한"이 못 막던 매시 재요청을 막는 자리다.
- `next_window`는 열린 창 보류가 있는 창을 건너뛴다(지금의 `failed_publications` 규칙과 같은 자리).
- 사람이 거는 보류(`operator`)는 이 단계에 넣지 않는다. 수동 운영 쓰기 금지 원칙과 부딪히고, 필요해지면
  Workflow 진입점으로 시스템이 쓰게 만든다.
- 소스별 요청량 상한은 이미 세마포어(`eatbid-source-live`·`eatbid-source-backfill`)가 동시성을 잡고 있다.
  이 결정은 **실패 뒤 재요청**을 막는 것이고 정상 요청량은 건드리지 않는다.

### D5. 릴리스 게이트 — "main이 초록인가"가 아니라 "이 커밋이 검증됐나"

`pnpm workflow:tag`의 preflight에 한 조건을 더한다. **origin/main HEAD 커밋의 `validate.yml` 최신 회차가
success**여야 한다. 아니면 거부한다. 오늘 v0.1.36은 main 회차가 실패로 끝난 2분 뒤에 태그됐다.

핫픽스 경로는 남긴다. `--hotfix "<사유>"`를 주면 거부하지 않되 사유가 annotated tag 메시지에 기록된다.
장애를 고치는 배포까지 막으면 안 된다는 2차 검토의 지적을 그대로 받는다.

### D6. 화면 — Grafana 대시보드 둘, 새 API·새 화면 없음

| 대시보드 | 표 | 무엇 |
|---|---|---|
| 운영 요약 | `monitoring.violation`, `monitoring.round`, `monitoring.notification` | 열린 위반 목록과 **나이**, 마지막 검사 시각과 신선도, 마지막 알림 성공 여부, 운영 image digest |
| 크롤러 진척 | `ingest.backfill_coverage`, `ingest.window_hold`, `ingest.run` | 창별 한 행: 발견·수집·정규화·발행·실패 발행·보류. 실시간(하루 창)과 백필(달 창) 분리. 완료율은 발행 완료율과 원본 확보율 **두 숫자** |

- 모든 패널에 "관측 시각"이 붙는다. 15분 주기 결과를 5초마다 새로고침해도 실시간이 아니다.
- 실패 발행이 있는 창은 그 창의 run과 격리 사유 상위 3개를 같은 행에서 펼친다. 이게 오늘의 "어느 창이 왜"다.
- `eatbid_grafana`에 `ingest.backfill_coverage`·`ingest.window_hold`·`ingest.run` SELECT만 추가한다. `ingest`
  전체 revoke는 유지한다.
- NestJS 운영 API, Next `/ops`, MCP는 만들지 않는다. 보는 사람이 한 명이고 Grafana와 psql이 같은 표를 읽는 동안
  세 번째 표면은 비용만 든다. 필요해지는 날 이 문서를 갱신한다.

### D7. run → 로그 다리를 한 번 실제로 건넌다

- 크롤러 진척 대시보드의 run 행에 OpenObserve 검색 data link를 단다. 조건은 `workflow_name`.
- **실패한 run 하나를 골라 링크를 눌러 그 파드의 로그가 실제로 나오는지 확인한다.** 안 나오면 그것이
  이 단계의 결과이고, 원인(fluent-bit 라벨, 보존, 검색 필드)을 고친다.
- `backfill-progress` 위반의 `logs=` 열(R2 workflow-logs 경로)도 같은 방법으로 한 번 열어 본다.
- **2026-09-16 실측(EAT-245).** `k8s` 스트림에는 파드 라벨(`kubernetes_labels_*`)이 없다. fluent-bit의 kubernetes
  필터가 라벨을 싣지 않는다. 대신 `kubernetes_pod_name`이 있고 Argo 파드 이름은 `<workflow_name>-<단계>-<해시>`라
  접두사 `like '<workflow_name>%'`로 잇는다. API로 실패한 poll-open(01:34 UTC)·전진·기대 검사 회차 셋 모두
  로그가 나왔다. 대시보드 링크는 그 SQL을 base64로 실어 OpenObserve 검색 페이지를 연다(UI 파라미터 해석은 배포
  뒤 브라우저로 한 번 더 확인).

### D8. AI 진입점 — 증상에서 질의로 가는 지도

- `docs/operations/diagnosis-map.md`: 증상 → 어느 표·어느 열 → 실제 명령. 오늘의 다섯 번 실수가 첫 항목들이다
  (context 이름 `eatbid-prod`, publication은 `run_id`로만 이어짐, run에는 창 열이 없고 창은 `request_unit`
  파라미터에서 파생, 위반은 `monitoring.violation`).
- `pnpm ops:status`: 읽기 전용 스크립트 하나. 열린 위반과 나이, 미완결 창, 열린 보류, 마지막 회차, 운영 digest를
  고정 SQL로 찍는다. AI도 사람도 같은 명령을 친다. 새 인프라 없이 "AI가 진단되는 구조"의 최소형이다.

## 4. 하지 않을 것

| 하지 않음 | 왜 |
|---|---|
| Prometheus·Alertmanager·Loki·Alloy | 12GB에서 DB와 메모리를 다툰다. 우리 알림은 지표가 아니라 기대에서 나며(ADR 0046 결정 4), 재알림은 SQL 한 줄이다 |
| Argo Workflow Archive | 자체 DDL을 돌린다(Drizzle 단일 작성자 위반). 실행 정체성은 `ingest.run`+`workflow_name`이 이미 소유 |
| 운영 API·`/ops` 화면·MCP | 조회가 막힌 원인은 전송이 아니라 데이터 위치. 표로 옮기면 psql과 Grafana로 끝난다 |
| incident 시스템·확인자 기록 | 1인 운영. "언제까지 조용히"는 필요해질 때 `violation`에 열 하나로 |
| 사람이 거는 보류 | 수동 운영 쓰기 금지. 필요하면 Workflow 진입점으로 |
| 매 PR에서 5년치 raw 값 범위 검증 | 별도 배치로 분포와 경계값을 조사하고 발견 사례만 회귀 테스트로(별도 issue) |
| Better Stack → 텔레그램 중계 | 별개 결정(EAT-238). 이 설계와 독립 |

## 5. 릴리스 순서와 인수 기준

릴리스 한 번은 태그·빌드·동기화·첫 검사까지 약 30분이다. 넷으로 묶는다.

| 릴리스 | 결정 | 운영에서 이것을 보면 끝 |
|---|---|---|
| R1 안전 | D3, D5 | 통합 테스트에서 기대 하나를 강제로 check-failed 시켜도 해소 알림이 없고 `first_seen_at`이 보존됨. 빨간 main HEAD에서 `workflow:tag`가 거부하고 `--hotfix` 사유가 태그에 남음(단위 테스트) |
| R2 신호 | D2, D1 | 좀비 run 위반이 `monitoring.violation`에 R2의 `first_seen_at`(2026-09-15 20:33 UTC)으로 이관됨. critical 하나를 실제로 60분 뒤 재알림 받음. 09:03 KST 요약 한 통 실측. Grafana에서 `select * from monitoring.violation where resolved_at is null`이 됨 |
| R3 차단 | D4 | 로컬 Argo smoke에 "차단 의심 응답 → 소스 보류 → 다음 discover Skipped" 음성 사례 추가. 운영에서 보류 0건, poll-open 정상 |
| R4 가시성 | D6, D7, D8 | 크롤러 진척 대시보드에 3월 창이 완결·실패 발행 4로 한 행에 보임. 실패 run의 로그 링크가 실제 로그를 연다. `pnpm ops:status`가 오늘의 질문 다섯 개에 질의 오류 0으로 답함 |

R1은 오늘 밤 안에 낼 수 있는 크기다. R2는 마이그레이션이 있어 하루, R3은 소스 어댑터의 차단 판정 정의가
있어 하루, R4는 대시보드 JSON이라 반나절이다.

## 6. 관통 시나리오 — 3월 창 사고가 다시 난다면

1. 06:20 전진이 3월 창을 받아 격리 6건으로 발행 실패. `failed_publications = 1`.
2. 07:00 전진은 그 창을 건너뛰고 다음 달을 받는다(지금 규칙). 같은 16,469건을 다시 받지 않는다.
3. 06:33 검사가 `failed-publication-window:20260301`을 **표에** 연다. normal이므로 텔레그램 한 통.
4. 그 사이 검사 질의가 한 번 흔들려도 위반은 `unobserved`로 남고 "해소됨"은 나가지 않는다(D3).
5. 다음 날 09:03 요약: "열린 것 2개, 가장 오래된 것 1일째 failed-publication-window:20260301". 첫 통을 놓쳤어도 여기서 본다(D1).
6. Grafana 크롤러 진척에서 3월 행을 펼치면 격리 사유 상위 3개와 run, 그 run의 로그 링크가 보인다(D6·D7).
7. AI에게 "3월 왜 막혔어"라고 물으면 `pnpm ops:status` → `diagnosis-map` 순으로 같은 표를 읽고 답한다(D8).
8. 파서 수정 → `workflow:tag`는 main HEAD가 초록일 때만 태그(D5) → replay → 창 완결 → 표의 행이 `resolved_at`을 얻고 "해소됨" 한 통.

## 7. 위험

- **재알림 피로.** 심각도 분류가 틀리면 60분마다 노이즈. 시작값을 보수적으로 두고 2주 뒤 `notification` 통 수로 조정한다.
- **차단 오탐으로 수집 정지.** 보류 상한 24시간, 보류가 열리면 critical 위반이 열려 사람이 안다. 판정 규칙은 소스 어댑터 안에 두고 테스트로 고정한다.
- **이관 시 과거 조작.** R2 문서에 있는 `first_seen_at`만 옮긴다. 없는 이력을 채우지 않는다.
- **표 하나가 늘어나면 Grafana 권한 경계.** `ingest` 전체 revoke는 유지하고 뷰·표 셋만 SELECT를 준다.

## 8. 결정 (2026-09-16 승인)

D1~D8과 R1 단독 선행을 승인했다. D2는 ADR 0054, D4는 ADR 0055로 R2·R3 릴리스에 앞서 쓴다.

별개로 남아 있는 결정: EAT-238(Better Stack → 텔레그램 중계), EAT-234(좀비 run 정리 방식), Sentry 프로젝트, `www` monitor 삭제.

## 9. 컴퓨팅이 늘어나면 — 확장의 방향을 지금 정해 둔다

이 설계는 12GB 단일 노드를 상한으로 잡았다. 컴퓨팅이 생기면 아래 순서로 쓴다. 관측 도구를 더 사는 데
쓰지 않는다.

| 순서 | 무엇 | 왜 |
|---|---|---|
| 1 | PostgreSQL을 자기 노드로 | 진실의 주인이 web·server·Grafana·OpenObserve와 메모리를 다투는 것이 가장 큰 단일 위험 |
| 2 | dev 환경 상시 가동, 운영 백업을 매일 복원 | "배포 전에 운영 데이터에 질의 한 번"을 규칙으로. 오늘의 하루 창 오탐이 재발하지 않는 자리 |
| 3 | 기술 health 층(Prometheus·kube-state·postgres exporter) | "서버 정상"과 "업무 정상"을 실제 두 층으로. **알림 원천이 아니라** Grafana 패널과 기대 probe의 재료로만. Alertmanager는 들이지 않는다 |
| 4 | 기대 검사 15분 → 5분, 회차 안 병렬화 | 신호 민감도 |
| 5 | OpenTelemetry trace 실수집, 보존 14일 → 90일 | web 요청에서 DB까지 한 request_id로 |
| 6 | replay·정규화·mart 재계산 병렬화 | 컴퓨팅으로 빨라지는 유일한 파이프라인 구간. 분석이 제품의 두뇌다 |

컴퓨팅이 있어도 바꾸지 않는 것: 알림은 기대에서 난다, 도착지는 하나, 진도는 파생·결정은 저장, DDL은 Drizzle
하나, 격리가 있으면 창 전체 거부, 배포 단위 셋.

확장이 재작성이 아니라 교체가 되게 하는 이음새: `ViolationProbe` 인터페이스(원천 추가 = 함수 하나),
`monitoring.violation.severity`(정책 자리 고정), 런타임 문서 §8.4 교체 표(ADR을 바꾸지 않고 갈아끼움),
Grafana 데이터소스(추가만), `window_hold.reason`(값만 늘어남).

**크롤러는 컴퓨팅으로 빨라지지 않는다.** 병목은 소스에 대한 예의(세마포어, 달 하나에 한 시간)이며 컴퓨팅이
열 배가 되어도 수집은 그대로다. 빨라지는 것은 수집 뒤의 정규화·재처리·mart다.
