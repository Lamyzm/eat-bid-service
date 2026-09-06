---
id: EVIDENCE-COLLECTION-CUTOVER-2026-09-06
status: active
canonical_for: collection-cutover-first-backfill
last_reviewed: 2026-09-06
review_trigger: workflow-template-or-cluster-capacity-change
---

# 수집 cutover와 첫 backfill (2026-09-05~06)

## 1. 결론

Hyper-V VM k3s 클러스터(EAT-50)에서 `eatbid-dataplane` WorkflowTemplate이 discover → capture →
normalize → validate → project를 무인으로 끝까지 통과했다. 2026-09-04 이후 레거시 수집 공백은
`mode=backfill 20260904..20260905` 한 번으로 메웠고, poll-open·daily-reconcile CronWorkflow는
suspend가 풀려 있다.

첫 제출은 normalize에서 22건이 죽었다. 원인은 코드가 아니라 fan-out 폭이다. DAG `withParam`이
발견 건수만큼 pod를 한꺼번에 띄워 단일 노드의 kubelet pod 상한(110)을 넘겼고, 그 사이 PostgreSQL이
연결을 받지 못했다. WorkflowTemplate `spec.parallelism: 4`로 고친 뒤 같은 창을 다시 제출한 것이
5절이다.

## 2. 실행 조건

| 항목 | 값 |
|---|---|
| 클러스터 | Hyper-V VM `eatbid-k3s`, k3s v1.35.5+k3s1, 4 vCPU · 12 GB, 노드 1 |
| Argo CD revision | 1차 `edfbe23`(v0.1.9 승격), 2차 `c7e0b7d`(parallelism 상한) |
| dataplane 이미지 | v0.1.9 `ghcr.io/lamyzm/eatbid-dataplane@sha256:629f51e5…`(build_sha는 git 커밋 40자, EAT-58) |
| parser-version | `eat-v1` (eat-v2는 EAT-43 전까지 발행 경로 아님) |
| 수집 창 | `20260904..20260905`, 입찰기간 겹침 필터 |
| 소스 동시성 | `eatbid-source-limit=1` semaphore (discover·capture 직렬) |
| DB 역할 | `eatbid_dataplane` (ingest·core 쓰기 grant는 2026-09-05 수동 적용, EAT-49) |

프로덕션 DB를 그대로 썼다. 1차 실행이 남긴 run·raw_observation은 지우지 않았다. 원본은 content
주소라 2차 실행이 같은 상세를 다시 받아도 R2 객체는 중복되지 않지만, 상세 응답에 초 단위 카운트다운이
있어 content sha가 매번 달라진다(2026-09-03 증거 8절). 따라서 raw_observation은 실행마다 새 행이다.

## 3. 1차 제출 `eatbid-backfill-20260904-qcfdx` — normalize 22건 실패

| 단계 | 결과 |
|---|---|
| discover | Succeeded, 131건 발견 |
| capture | 131/131 Succeeded (semaphore 1, 약 7초/건) |
| normalize | 109 Succeeded / 22 Failed (exit 64, stderr `CONFIGURATION` 한 줄) |
| validate · project | Omitted (depends 조건 불충족) |

DB에는 run 2, raw_observation 133(목록 2 + 상세 131), normalized_record 109, publication 0이
남았다. 실패 22건은 `normalization_attempt`에 행이 없다. 프로세스가 DB에 닿기 전에 죽었다는 뜻이다.

### 3.1 시간선

- 15:34:20~34Z: normalize pod 131개가 14초 안에 전부 생성됐다.
- 즉시 `FailedScheduling: 0/1 nodes are available: 1 Too many pods.` 이벤트가 반복됐다. kubelet
  기본 pod 상한 110에 시스템·서비스 pod가 더해져 노드가 꽉 찼다.
- 15:35~15:38Z: 실행된 pod들이 4 vCPU를 포화시켰다. `postgres` readiness probe(`pg_isready` 1초)와
  `server` `/health/ready`가 시간 초과됐다. postgres 로그에는 `connection to client lost`,
  `Connection reset by peer`가 남았다.
- 실패 pod의 main container는 시작 뒤 약 2분 18초 만에 exit 64로 끝났다. 이 길이는 DB 연결 시간
  초과와 일치한다. 커널 OOM kill은 없었다(`journalctl -k` 확인).

### 3.2 판단

- 코드 결함이 아니다. 같은 이미지가 109건을 정규화했고, 실패 건은 모두 연결 단계에서 죽었다.
- 2026-09-03 첫 실행(85건)이나 k3d 검증에서는 fan-out이 상한 아래였을 뿐이다. 학기 피크(하루
  7,000건대)를 생각하면 상한 없는 fan-out은 어떤 노드 크기에서도 재발한다.
- CLI가 실패 이유를 `CONFIGURATION` 한 단어로만 남긴 것은 별개 결함이며 EAT-59 범위다.

## 4. 조치

WorkflowTemplate `spec.parallelism: 4` (커밋 `89a7421`, main `c7e0b7d`). capture는 source
semaphore로 이미 직렬이므로 이 값은 사실상 normalize 동시성이다. infra contract test가 상한의
존재와 범위(1..16)를 고정한다. `workflowTemplateRef`로 제출된 Workflow는
`storedWorkflowTemplateSpec.parallelism=4`를 상속한다(2차 제출에서 확인).

## 5. 2차 제출 `eatbid-backfill-20260904-lnbjt` — 끝까지 성공

Workflow uid `9e0a12d8-c305-43a3-aa10-54390079f929`, `storedWorkflowTemplateSpec.parallelism=4`.
15:58:56Z 시작, 16:49:06Z Succeeded(50분 10초).

| 단계 | 결과 | 시간 |
|---|---|---|
| discover | Succeeded, 131건(1차와 같음) | 9초 |
| capture | 131/131 Succeeded | 15:59~16:36Z, 약 37분(semaphore 1, 건당 약 17초 pod 주기) |
| normalize | 131/131 Succeeded, 격리 0 | 16:36:39~16:48:24Z, 약 12분(4병렬, 건당 약 10초) |
| validate | Succeeded | 8초 |
| project | Succeeded | 9초 |

실행 중 `FailedScheduling`·readiness `Unhealthy` 이벤트는 없었다. 이 노드에서 normalize 4병렬은
여유가 있다. capture가 전체 시간의 대부분이며 이는 source semaphore가 의도한 비용이다.

### 5.1 DB 적재 (1차 잔여 포함 누계)

| 테이블 | 행 | 해석 |
|---|---|---|
| `ingest.run` | 4 | 실행마다 discovery run + detail run. 1차 detail run은 `running`으로 남음 |
| `ingest.source_release` | 2 | 1차 `planned`, 2차 `sealed`(16:48:37Z) |
| `ingest.raw_observation` | 266 | bid-list 4 + bid-detail 262 (실행당 131) |
| `ingest.raw_blob` | 264 | 목록 응답 2쌍이 content 주소로 중복 제거됨 |
| `ingest.normalized_record` | 240 | 1차 109 + 2차 131 |
| `ingest.normalization_attempt` | 240, 전부 `normalized` | 격리율 0 % |
| `ingest.publication` | 1 | `published`, expected=normalized=published=131, validated 16:48:37Z, activated 16:48:48Z |
| `ingest.publication_record` | 131 | |
| `core.auction_attempt` / `auction_revision` | 131 / 131 | external_bid_id 131개 고유 |
| `core.organization` | 54 | 전부 `type=unknown` (eat-v1 projection 한계, EAT-43 이후 과제) |
| `core.code_value` / `auction_revision_code_value` | 145 / 429 | code_scheme 7 |

detail run `5e8cfcc3-…`는 `published`, `expected_count=captured_count=published_count=131`,
`build_sha=1f528fd3…`(v0.1.9 git 커밋, EAT-58 계약대로 40자)이다.

### 5.2 공개 뷰

`GET https://eatbid.net/api/v1/auctions/1` → 200. `externalBidId=5789710`, 상태 `진행중`, 기초금액
`123164000.00 KRW`, provenance에 `observationId`·`normalizedRecordId`가 실린다. `organization.name`은
`null`, `type`은 `unknown`이다. 기관 정보는 이 slice의 범위가 아니라 eat-v1 projection의 현재 한계다.

### 5.3 1차 잔여물

1차 실행의 detail run(`54338d60-…`, `running`)과 release(`11ba811b-…`, `planned`)는 봉인되지
않은 채 남아 있다. 관측 133건과 정규화 109건은 원본 증거로서 유효하고 어떤 publication에도 속하지
않는다. 상태를 손으로 고치지 않았다. 중단된 run을 `failed`로 닫는 절차는 없으며 별도 결정이 필요하다.

## 5.4 첫 스케줄 실행 — daily-reconcile 2026-09-06 07:00 KST

CronWorkflow `eatbid-daily-reconcile`이 사람 개입 없이 22:00:00Z에 `eatbid-daily-reconcile-1788645600`을
만들었고 23:39:25Z에 Succeeded했다(1시간 39분). 이미지는 v0.1.11, `parallelism=4` 상속.

| 단계 | 결과 |
|---|---|
| discover | 254건(열린 공고 전체, backfill의 131건 포함) |
| capture | 254/254 |
| normalize | 254/254, 격리 0 |
| validate · project | publication `95b3ff6e-…` published, expected=normalized=published=254 |

core는 attempt 254(재관측된 131건은 새 revision으로 append), revision 385. 이 실행이 "매일 07시
daily-reconcile Succeeded" 수용 기준을 채운다. poll-open은 평일 스케줄이라 첫 실행은 2026-09-07(월)
08:00 KST다.

## 6. 남은 것

- poll-open(평일 08~19시 30분) 첫 실행 확인(2026-09-07 월 08:00 KST). 2026-09-05·06은 주말이라
  돌지 않았다.
- EAT-59: 실패 pod가 예외 종류와 메시지를 JSON으로 남기게 한다.
- EAT-49: dataplane 역할 grant를 수동 SQL이 아니라 provisioning 스크립트로 옮긴다.
- EAT-69: 2절의 `parser-version`은 이 실행 시점의 값이다. 그 뒤 WorkflowTemplate 기본값을 `eat-v2`로
  옮겼으므로(다음 daily-reconcile부터 적용) 여기 남은 v1 발행물과 새 v2 revision은 서로 다른 실행이다.
- 중단된 run·source_release를 닫는 절차(5.3절)와 eat-v1 projection의 기관 정보 공백(5.2절)은
  각각 별도 결정으로 다룬다.
- capture 건당 약 17초 중 소스 응답은 약 7초이고 나머지는 pod 생성·종료 비용이다. 피크(하루
  7,000건대)에서는 backfill 한 창이 하루를 넘기므로, 그 전에 capture 단위를 pod당 여러 건으로 묶을지
  판단해야 한다.
