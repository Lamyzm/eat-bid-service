---
id: PLAN-OBSERVABILITY-HEARTBEAT-AND-SHAPE-2026-09-16
status: plan
canonical_for: none
last_reviewed: 2026-09-16
review_trigger: alert-origin-or-monitoring-storage-change
---

# 시스템이 살아 있는지 스스로 말하게 만드는 순서 (2026-09-16, EAT-171 → EAT-174)

결정은 [ADR 0046](../../adr/0046-telemetry-wire-correlation-and-alert-origin.md)이 소유한다. 이 문서는 그
결정 가운데 아직 구현되지 않은 것을 어떤 순서로, 어디에 만드는지만 적는다. 상태의 원천이 아니다.

## 0. 지금 사실 (2026-09-16 01:40 KST 실측)

- **살아 있는지 말해 주는 신호는 하나뿐이다.** `capture-freshness` — 평일 09~19시 KST에 `poll-open`이
  45분 안에 돌았는가. 그 밖의 시간, 즉 평일 저녁·밤과 주말 전체(한 주의 약 60%)에는 어떤 생존 검사도
  없다. `daily-reconcile`·`reference-refresh`에는 기대 자체가 없다.
- **돌긴 도는데 아무것도 안 하는 경우를 잡는 것이 없다.** 전진 cron이 2026-09-14 22시부터 28시간 동안
  매시 `Succeeded`로 끝나면서 목록 요청 0건을 냈고, 아홉 기대 어느 것도 울리지 않았다. 잡은 것은
  사람이 커버리지 view를 열어 본 것이었다.
- **기대 아홉은 한 프로세스에서 돈다.** `check-expectations`는 조립 단계에서 `psycopg.connect`가 실패하면
  텔레그램에 닿기 전에 exit 64로 죽는다. DB가 죽으면 아홉이 동시에 침묵한다. 노드가 죽어도, Argo
  controller가 죽어도 같다. 침묵은 정상과 구분되지 않는다.
- **클러스터 밖에서 확인하는 것은 설계에만 있다.** ADR 0046 결정 6의 "밖 절반"인 EAT-171은 `Ready`
  상태로 남아 있다. 2026-09-10에 옛 VM이 28시간 죽어 있었고 사용자가 물어서 알았다.
- **지표는 0개다.** 시계열이 하나도 없어 "오늘이 평소보다 적은가", "언제부터 줄었나"를 물을 수 없다.
  이 세션에서 그런 질문마다 SQL을 손으로 짜 일회용 파드를 띄웠다.
- **로그는 반만 있다.** Argo Workflow 로그는 R2 `workflow-logs/<yyyy>/<mm>/<워크플로 이름>/<파드>/main.log`
  에 보관된다(4,739객체, 25MiB, EAT-172). 서버는 구조화 JSON을 `process.stdout`에 쓰지만 받아 두는
  곳이 없어 파드가 재시작하면 사라진다. 웹은 telemetry 모듈이 없다. 로그 수집기는 없다.
- **오류 추적기는 설치만 돼 있다.** `apps/web/next.config.ts`가 `@sentry/nextjs`를 감싸지만
  `NEXT_PUBLIC_SENTRY_ORG`·`NEXT_PUBLIC_SENTRY_PROJECT`가 manifest 어디에도 없어 `disable: true`로 접힌다.
  서버에는 없다.
- **식별자가 서로를 모른다.** 릴리스 이름은 워크플로 uid를, R2 로그는 워크플로 이름을, `ingest.run`은
  `build_sha`를, 알림은 `run_id`를 든다. uid와 이름을 함께 가진 유일한 물건이 Argo의 Workflow 객체인데
  성공은 1시간, 실패는 24시간 뒤에 지워진다. 그 뒤로는 R2에 증거가 있어도 가리킬 방법이 없다.
- **노드에는 자리가 있다.** allocatable 12GiB 중 4.8GiB 사용(40%). Grafana·Loki·promtail(합쳐 약
  400MiB)을 올릴 여유가 있다.
- **배포는 두 번 손으로 살렸다.** cosign이 GitHub OIDC 토큰을 못 읽어 v0.1.32 발행이 죽었고 재시도가
  없어 사람이 다시 돌렸다. 빌드 중 병합이 들어와 v0.1.30이 promote에서 버려졌고, 그 규칙은 문서에도
  코드에도 없다.

## 순서와 이유

| 단계 | 무엇 | 닫는 구멍 | 사용자 손 |
|---|---|---|---|
| 1 | 클러스터 밖으로 나가는 심장박동 | DB·노드·검사 자체가 죽었을 때의 침묵 | 제공자 계정, 핑 URL을 Infisical에 |
| 2 | 회차마다 남기는 모양 지표 | 예상 못 한 사고("돌긴 도는데 0건") | 없음 |
| 3 | 이미 있는 것을 연결 — Sentry, 서버 로그 보관, Grafana | 웹·서버가 깨져도 모르는 것, 파드 재시작이 로그를 지우는 것 | Sentry 프로젝트, DSN을 Infisical에 |
| 4 | 워크플로 이름을 기록된 사실로 | 사고 뒤 네 군데를 손으로 오가는 것 | 없음 |
| 5 | 배포 자가복구 | cosign 일시 장애, 빌드 중 병합 | 없음 |
| 6 | 아키텍처를 단계별로 같이 훑기 | 이 문서가 모르는 구멍 | 함께 |

1이 먼저인 이유는 나머지 전부가 클러스터 안에 있기 때문이다. 안에 있는 것은 기계와 함께 죽는다.
연기 감지기 없는 집을 감사하는 것이 6이므로 1을 앞에 둔다. 2가 3보다 앞인 이유는 새 스택 없이 이미 도는
검사에 행 하나를 더하는 일이라 하루면 끝나고, 3의 Grafana가 그릴 대상이 그것이기 때문이다.

**하지 않는 것.** 열 번째 기대를 더하는 것 — 예상한 것만 잡는 도구를 늘려도 예상 못 한 것은 못 잡는다.
OTel 전체(EAT-173)를 지금 세우는 것 — 맞는 방향이지만 몇 주짜리이고 위의 1~3이 며칠에 80%를 준다.
알림 수명주기를 Alertmanager로 옮기는 것 — 2026-09-15에 지금 구조를 유지하기로 정했다.

## 1단계 — 클러스터 밖으로 나가는 심장박동 (EAT-171)

**무엇.** `check-expectations`가 한 회차를 **끝까지** 마쳤을 때 바깥의 dead man's switch를 한 번 친다.
"끝까지"는 아홉 기대를 다 평가하고, 새 위반이 있으면 텔레그램 전송이 성공하고, 상태 문서를 R2에 쓴
뒤다. 핑이 15분 주기 + 유예 15분, 합쳐 30분 끊기면 바깥이 텔레그램으로 알린다.

이 하나로 닫히는 것: 노드 사망, DB 사망, R2 접근 불가, Argo controller 정지, 검사 프로세스 자체의
버그, 텔레그램 전송 실패(전송이 실패하면 핑에 닿지 않는다). 전부 지금은 침묵인 것들이다.

**제공자.** EAT-171이 요구한 네 기준 — 무료 구간 한도, 신호 주기, 제공자 자신의 장애 알림, 상태 페이지
제공 — 으로 고른다. 심장박동(push)과 공개 사이트 응답(pull, ADR 0046이 허용한 유일한 밖→안 확인)을
**한 제공자**가 다 하고 텔레그램 수신자를 내장한 곳을 고른다. 알림 도착지가 하나여야 한다(결정 6).
후보는 Better Stack Uptime(heartbeat + HTTP + 텔레그램 + 상태 페이지)과 healthchecks.io(heartbeat +
텔레그램, HTTP는 없음, 오픈소스). 계정을 만들 때 무료 구간을 실제로 확인하고 선택 근거를 EAT-171에
남긴다. 제공자 자신의 장애는 push 설계상 알릴 수 없으므로 "핑 URL에 닿지 못하면 검사를 실패로 끝낸다"로
대신한다 — 그러면 안쪽 `cron-workflow` 기대가 15분 안에 텔레그램으로 알린다.

**어디.**

- `apps/dataplane/src/eatbid/config.py` — `heartbeat_url: SecretStr | None`, alias `EATBID_HEARTBEAT_URL`.
  핑 URL은 쓰기 토큰이나 다름없어 `SecretStr`이고 `repr=False`다. 선택인 이유는 텔레그램 설정과 같다 —
  수집 파드는 이 값 없이 떠야 한다.
- `apps/dataplane/src/eatbid/monitoring/heartbeat.py` — 새 모듈. `send_heartbeat(url, *, timeout_seconds)`
  하나. `httpx.get`으로 치고 `raise_for_status()`. 실패는 예외로 올린다. 조용히 삼키면 제공자가 죽은
  동안 안팎이 함께 침묵한다.
- `apps/dataplane/src/eatbid/composition.py` — `_MonitoringRunner.run()`이 `run_expectation_check`가
  돌아온 **뒤** 핑을 친다. 그 앞이면 텔레그램 실패를 덮는다. `heartbeat_url`이 없으면 치지 않고 결과에
  `heartbeat: "skipped"`를 남긴다 — 없는 것과 실패한 것은 다른 사실이다.
- `infra/base/workflows/expectation-check.yaml` — env `EATBID_HEARTBEAT_URL`을 `eatbid-alerting` Secret의
  `HEARTBEAT_URL` 키에서 받는다.
- `infra/product/secret-contract.md` — `eatbid-alerting` 행에 `HEARTBEAT_URL`을 더한다. 환경별로 다르다
  (prod와 dev의 심장박동은 서로 다른 check다).
- Infisical `prod:/runtime/alerting` — `HEARTBEAT_URL` 값. 사용자가 넣는다.
- `docs/operations/collection-runbook.md` — "심장박동이 끊겼다" 절. 첫 확인은 `kubectl get nodes`,
  다음은 `kubectl -n eatbid get cronworkflow eatbid-expectation-check`의 suspend, 다음은 최근 회차 로그
  (`workflow-logs/<yyyy>/<mm>/eatbid-expectation-check-<n>/`).

**검사.**

- 단위: `tests/unit/test_monitoring_heartbeat.py` — URL이 없으면 치지 않고 `skipped`, 있으면 정확히 한 번
  GET, 4xx/5xx면 예외. `test_cli.py` — `check-expectations` 결과 JSON에 `heartbeat` 필드.
- 계약: `infra/tests/test_workflow_contract.py` — expectation-check cron이 `EATBID_HEARTBEAT_URL`을
  `eatbid-alerting`/`HEARTBEAT_URL`에서 받는다. `test_product_secret_contract.py`의 키 목록 갱신.
- **운영에서 실물 확인(인수 기준).** 배포 뒤 제공자 화면에 첫 핑이 찍힌 것을 본다. 그 다음 일부러
  끊는다 — `kubectl -n eatbid patch cronworkflow eatbid-expectation-check -p '{"spec":{"suspend":true}}'`
  로 35분 두면 텔레그램에 "down"이 와야 한다. 다시 켜면 "up"이 와야 한다. 두 메시지의 시각을 EAT-171에
  붙인다. 이것이 "클러스터를 의도적으로 내렸을 때 알림이 온다"의 검증이다.

**같은 제공자에 공개 사이트 확인.** `https://eatbid.net/today`를 5분 간격으로 pull한다. 이것은 코드
변경이 없고 제공자 설정뿐이다. `/today`인 이유는 web의 readinessProbe가 보는 경로와 같아서, 살아 있다는
정의를 두 곳에서 다르게 두지 않기 위해서다.

## 2단계 — 회차마다 남기는 모양 지표

**무엇.** 이미 15분마다 DB에 붙는 `check-expectations`가 회차 끝에 **행 하나**를 남긴다. 알림의 근거가
아니라 사람이 보는 모양이다(ADR 0046 결정 4는 지표로 판정하지 말라고 했지 지표를 두지 말라고 하지
않았다). 이것이 있으면 "크롤링이 살아 있나"의 답이 "선이 움직이나"가 된다.

| 열 | 뜻 | 어디서 |
|---|---|---|
| `observed_at` | 회차 시각 | 검사 프로세스 |
| `environment` | prod/dev | `EATBID_ENVIRONMENT` |
| `runs_started_1h` | 최근 1시간 시작된 run 수, mode별 jsonb | `ingest.run` |
| `runs_failed_1h` | 그중 failed | `ingest.run` |
| `auctions_published_1h` | 최근 1시간 발행된 revision 수 | `core.auction_revision` → `raw_observation.fetched_at` |
| `open_auctions_now` | 지금 열린 공고 | `mart.open_auction_snapshot` 활성 build |
| `backfill_windows_incomplete` | 미완 한 달 창 수 | `ingest.backfill_coverage` |
| `violations_open` | 열린 위반 수 | 상태 문서 |
| `check_duration_ms` | 이 회차가 걸린 시간 | 검사 프로세스 |

**어디.** 새 schema `monitoring`, 표 `monitoring.round`. Drizzle이 DDL을 소유하므로
`packages/db/src/schema/monitoring/round.ts`에 선언하고 migration을 커밋한다(AGENTS 10).
`infra/base/db-provisioning.sql`에 `eatbid_dataplane`의 `monitoring` 쓰기 권한과 읽기 전용 역할
`eatbid_grafana`의 `monitoring`·`mart` SELECT를 더한다 — 역할 생성은 provisioning이 하지 않으므로 operator
bootstrap 절차에 한 줄 더한다. 쓰기 지도(`docs/architecture/ingestion-write-map.md`)에 `monitoring.round`
의 소유자로 `check-expectations`를 적는다 — `write-map` gate가 이것을 요구한다.

**왜 R2가 아닌가.** 3단계의 Grafana가 SQL로 바로 읽어야 하고, 상태 문서와 달리 이것은 덮어쓰는 값이
아니라 쌓이는 사실이다. 회차당 한 행, 하루 96행, 한 해 3만5천 행이라 보존 정책 없이 둔다.

**검사.** 단위 — 열 아홉이 전부 채워지는지, 표본 0일 때 0으로(NULL이 아니라) 남는지. 통합 —
`migrated_db`에 한 회차 돌려 행 하나. 운영 — 배포 하루 뒤 `select * from monitoring.round order by
observed_at desc limit 96`이 96행이고 `runs_started_1h`가 영업시간에 6 안팎, 밤에 0~1이다.

## 3단계 — 이미 있는 것을 연결한다

**3a. Sentry를 켠다.** 코드는 이미 있다. 빠진 것은 값 셋 — `NEXT_PUBLIC_SENTRY_ORG`,
`NEXT_PUBLIC_SENTRY_PROJECT`, `SENTRY_DSN`. 새 InfisicalSecret `eatbid-sentry`(`/runtime/sentry`)를
`infra/base/secrets.yaml`에 더하고 web Deployment에 env로 준다. `test_product_secret_contract.py`의
"여섯"이 "일곱"이 된다. 소스맵 업로드(`SENTRY_AUTH_TOKEN`, 빌드 시점)는 후속 — 지금은 스택이 minified여도
"깨졌다"는 사실이 먼저다. 서버 쪽 Sentry(`@sentry/node`)는 그 다음이다.

**3b. 서버 로그를 받아 둔다.** Loki + promtail을 `infra/platform/loki.application.yaml`로 올린다(Argo CD
Application, argo-workflows와 같은 모양). promtail이 `eatbid` namespace 파드의 stdout을 Loki로 보낸다.
서버가 이미 JSON 한 줄씩 쓰므로 파싱 규칙이 필요 없다. 보존 7일. 노드에 자리는 있다(0절).

**3c. Grafana.** `infra/platform/grafana.application.yaml`. 데이터 소스 둘 — PostgreSQL(`eatbid_grafana`
역할)과 Loki. 대시보드 하나를 provisioning으로 커밋한다: 2단계의 아홉 열이 각각 선 하나, 아래에 최근
서버 로그. 접근은 내부 Ingress(`infra/base/internal-ingress.yaml`의 `ipAllowList` 뒤)이며 밖에 열지
않는다(ADR 0012). 이것이 EAT-174다.

**검사.** 3a — 운영 web에 일부러 throw 하나를 넣은 릴리스를 내는 대신, 브라우저 콘솔에서
`Sentry.captureMessage('probe')`를 쳐 Sentry에 도착하는 것을 본다. 3b — 서버 파드를 재시작한 뒤
Grafana에서 재시작 전 로그가 보인다. 3c — 대시보드 스크린샷을 `docs/evidence/operations/`에 남긴다.

## 4단계 — 워크플로 이름을 기록된 사실로 (ADR 0046 결정 1의 다리)

**무엇.** `ingest.run`에 `workflow_name text` 열. `discover`(run을 만드는 단계)가 `{{workflow.name}}`을
env `EATBID_WORKFLOW_NAME`으로 받아 `--workflow-name`으로 넘기고 run 행에 쓴다. 알림 문구의 `detail`에
`logs=workflow-logs/<yyyy>/<mm>/<이름>/`을 붙인다.

**닫히는 것.** 알림의 run_id → 로그, 워크플로 실패 → run 행과 build_sha, 실패한 릴리스 → 그 회차 로그.
셋 다 지금은 Argo 객체가 지워진 뒤 끊긴다.

**어디.** `packages/db/src/schema/ingest/run.ts` 열 추가 + migration, `apps/dataplane/src/eatbid/cli/arguments.py`
인자, `ingest/postgres_repository.py`의 run 생성, `infra/base/workflows/workflow-template.yaml`의 discover
env, `monitoring/expectations.py`의 `backfill-progress` SQL이 `workflow_name`을 함께 select.

## 5단계 — 배포 자가복구

**5a. cosign 재시도.** `.github/workflows/build.yml`의 `cosign sign`·`attest`를 세 번까지 20초 간격으로
다시 시도한다. OIDC 토큰 조회는 GitHub 쪽 일시 장애가 있고, 그때 사람이 `gh run rerun --failed`를 치는
것이 지금 절차다.

**5b. 빌드 중 병합 방지.** `tools/agent-workflow/release.mjs` — 태그를 만들기 전에 (1) `build.yml` 회차가
`in_progress`이면 거부, (2) 열린 PR 가운데 auto-merge가 켜진 것이 있으면 목록을 보이고 거부. `pnpm
workflow:release -- v0.1.N`으로 부른다. `docs/operations/collection-runbook.md`가 아니라 릴리스 절을 갖는
runtime 문서 §5에 "릴리스 중 병합 금지"를 규칙으로 적는다. promote의 거부 자체는 맞는 동작이므로
바꾸지 않는다.

## 6단계 — 아키텍처를 단계별로 같이 훑는다

1단계가 운영에 들어간 뒤 한다. 여덟 단계(예약 → 발견 → 상세 → 해석 → 검증·봉인 → 발행 → 파생 → 배포)
마다 셋을 묻는다 — 설계가 뭐라 하나, 실제로 뭐가 일어나나, **멈추면 어떻게 아나.** 각 단계를 열 때
설계 문서와 실제 DB·클러스터를 같이 보고 그 자리에서 빈칸을 채운다. 기록은
`docs/evidence/operations/2026-09-XX-architecture-walkthrough.md`에 남기고, 거기서 나온 구멍은 이
문서의 새 단계가 아니라 별도 이슈로 낸다. 사람이 하나씩 보는 시간이지 도구가 훑는 시간이 아니다.

## 사용자 손이 필요한 것

| 언제 | 무엇 | 걸리는 시간 |
|---|---|---|
| 1단계 시작 | 제공자 계정, heartbeat check 하나(15분/유예 15분), HTTP check 하나(`eatbid.net/today`), 텔레그램 연결, 핑 URL을 Infisical `prod:/runtime/alerting`의 `HEARTBEAT_URL`에 | 15분 |
| 3a | Sentry 프로젝트, DSN·org·project를 Infisical `prod:/runtime/sentry`에 | 10분 |
| 2단계 | `eatbid_grafana` 역할 생성(operator bootstrap) | 5분 |
| 6단계 | 같이 앉는 시간 | 단계당 20분 |

나머지는 전부 코드와 manifest다.

## Non-goals

OTel 계측(EAT-173) — 이 문서의 2·3단계가 자리를 비워 두고 값만 다른 형태로 나중에 들어온다. 상태
페이지 공개 — EAT-171이 "사용자가 생긴 뒤"로 정했고 제공자가 부가로 주므로 그때 켠다. dev 환경의
심장박동 — dev 클러스터가 생긴 뒤 같은 코드에 다른 URL이다. Alertmanager — 2026-09-15 결정으로 제외.
