---
id: INGESTION-WRITE-MAP
status: active
canonical_for: dataplane-write-targets-and-boundaries
last_reviewed: 2026-09-17
review_trigger: dataplane-write-target-or-transaction-boundary-change
---

# 수집 쓰기 지도

이 문서는 "어느 수집 단계가 R2와 어느 표에 무엇을 어떤 경계로 쓰는가"에 답한다. 3절의 모듈별 표는
`tools/architecture/check-write-map.mjs`(architecture gate `write-map`)가 dataplane 소스의
`insert into`·`update`·`delete from`·R2 `put_object` 대상과 대조한다. 새 표에 쓰기 시작하거나 쓰기를
없애면 같은 커밋에서 그 표를 고쳐야 gate가 통과한다. 표·컬럼·외래키의 현재 모양은
[생성된 ERD](generated/)가 보여 주며 `pnpm architecture:erd:write`로만 갱신한다.

## 1. 저장 위치는 여섯 곳이고 각각 이유가 있다

| 저장 위치 | 무엇을 담는가 | 왜 따로 두는가 | 근거 |
|---|---|---|---|
| R2 `raw/{source}/{endpoint}/{sha256}.{xml\|txt}.gz` | 소스가 보낸 바이트 그대로. 내용 주소라 같은 바이트는 한 객체다 | 파서가 틀려도 원본에서 다시 만든다. DB 기록보다 먼저 쓴다 | AGENTS 1·3, ADR 0010 |
| PostgreSQL `ingest` | run·요청 단위·관측·정규화 시도(격리 포함)·발행 manifest·release 봉인 | "무엇을 언제 관측했고 무엇을 공개해도 되는가"의 장부. 부분 결과가 공개되지 않게 막는 gate가 여기 산다 | ADR 0014, 0025 |
| PostgreSQL `core` | 해석된 업무 사실(attempt·revision·기관·명단·낙찰·업체·코드) | 봉인·검증된 publication만 한 transaction으로 앉힌다 | ADR 0015, 0033, 0035, 0038 |
| PostgreSQL `mart` | 결정 화면용 파생 표와 build ledger | 언제든 다시 만들 수 있고 활성 포인터 교체가 원자다 | ADR 0011, 0034 |
| PostgreSQL `app` | 사용자·workspace·등록 사업자 | API만 쓴다. 수집기는 닿지 않는다 | ADR 0032 |
| PostgreSQL `monitoring` | 감시 회차마다 남기는 모양 지표(`round`) | 진실 원천이 아니라 관측의 기록이다. 판정은 기대(expectations)가 하고 이 표는 사람이 보는 선이라 넷과 따로 둔다 | ADR 0046 결정 4, EAT-227 |

`core.code_scheme`은 마이그레이션 seed(`packages/db/src/seeds/code-schemes.ts`)만 쓰고 수집기는 읽기만
한다. 수집기가 `app`에 쓰는 경로는 없다.

## 2. 단계별 흐름과 경계

CLI 명령 하나가 Argo `WorkflowTemplate`의 task 하나다([runtime-and-deployment.md](runtime-and-deployment.md) §2).
`ingest` 표는 schema 접두사를 생략했다.

| 단계 (CLI) | 쓰는 곳 | transaction·잠금 경계 | 지키는 조건 | 근거 |
|---|---|---|---|---|
| `discover` | R2 목록 page, `run`(발견 run과 상세 run), `request_unit`, `raw_blob`·`raw_observation`, `source_release`(+`_dataset`·`_run`·`_observation`) | repository 호출 하나가 짧은 transaction 하나다. 목록 page는 R2 put이 끝난 뒤에만 관측으로 기록된다. 상세 재호출 대상은 마지막 봉인 release와 대조해 좁힌다 | 발견한 숫자 ID manifest가 release의 expected가 된다 | ADR 0010, 0025, 0037 |
| `capture` | R2 상세 응답, `raw_blob`·`raw_observation`, `request_unit`(예약·해제), `run`(실패 종료), `source_release_observation`, `source_release_dataset`(진행 수) | `reserve_capture`가 request_unit과 run을 `for update`로 잠근다. 같은 단위를 다시 돌리면 기존 canonical 관측을 돌려주고 소스를 부르지 않는다(resume). chunk pod 단위이며 소스 semaphore로 직렬이다 | 요청 단위당 canonical 관측 1건 | ADR 0010, 0014, EAT-122 |
| `normalize` | `normalization_attempt`, `normalization_attempt_record`, `normalized_record` | 관측·publication record·request unit·blob을 `for update`로 잠근 한 transaction. 파싱 실패는 status `quarantined`와 사유를 가진 attempt 행이며 record를 만들지 않는다 | attempt는 run 범위이고 같은 payload는 같은 record다 | ADR 0014, 0038 |
| `validate` | `source_release`(sealed 또는 failed)·`run`, `publication`·`publication_record` | 봉인이 먼저다. READ COMMITTED terminal transaction에서 release를 `for update`로 잠그고 `observed = expected`, `normalized + quarantined = observed`를 검사한다. 그다음 run을 잠그고 publication을 pending에서 validated 또는 failed로 옮긴다. failed면 그 category가 exit code다 | 격리가 있어도 관측 집합은 완결된다 | ADR 0025, EAT-122 |
| `fail-release`(운영자) | `source_release`(failed), `run`(닫힘) | 같은 terminal transaction. planned만 대상이고 같은 category 재실행은 멱등이다 | 어떤 단계도 자동으로 여기 오지 않는다 | EAT-122, [runbook §4.3](../operations/collection-runbook.md) |
| `project` | `publication`(active 또는 failed)·`run`, `core.organization`·`organization_identifier`·`auction_attempt`·`auction_attempt_link`·`auction_revision`·`auction_organization`·`auction_revision_code_value`·`code_value`·`code_label_observation`·`bid_submission`·`award_decision`·`source_supplier_account`·`supplier_party` | publication과 run, 공고 topology, manifest 구성원을 순서대로 잠근 한 transaction. Argo mutex `eatbid-core-publication`. 실패 기록은 별도 연결로 남겨 되감기에서 살아남는다. 성공 뒤 web cache 무효화 요청은 부수 효과이며 성공 조건이 아니다 | 잠근 행 집합이 manifest와 같고 관계 집합을 검증한다 | ADR 0015, 0033, 0036, 0038 |
| `build-marts` | `mart.build`(ledger)·`build_coverage`·`org_round_summary`·`win_rate_distribution_monthly`·`open_auction_snapshot`·`open_auction_snapshot_item`(스냅샷 행의 품목 원자 다리표)·`org_round_summary_item`(회차 요약 행의 품목 원자 다리표)·`build_vocabulary_gap`(어휘 밖 조각과 행 수), 그리고 스냅샷이 가리킬 `core.auction_attempt` 행 보장 | mart마다 build 행을 `for update`로 잡고 채움 → 검증 → 활성화 순서다. 활성화는 같은 mart의 active를 superseded로 바꾸고 verified를 active로 올리는 한 commit이다. Argo mutex `eatbid-mart-build` | 활성 포인터 교체가 원자이고 stale은 정상이다 | ADR 0011, 0034 |
| `reap-marts`(예약) | `mart.org_round_summary`·`win_rate_distribution_monthly`·`open_auction_snapshot`(행 삭제; 스냅샷·회차 요약의 품목 다리표는 FK cascade로 함께), `build_coverage` | build 하나가 transaction 하나다. `retain_until`이 지난 `superseded` build만 고르고 build 원장 행은 남긴다. mutex 없음 — superseded는 종착 상태라 활성화와 같은 행을 다투지 않고, 표의 trigger가 build 상태로 다시 거른다 | ADR 0034가 허용한 유일한 공개 mart 행 삭제다. 회수 여부는 원장 열이 아니라 "행이 없다"로 파생된다 | ADR 0034, EAT-254 |
| `replay` | `run`(replay)·`replay_input`·`publication`, 그 뒤 `normalize`·`validate`·`project`와 같은 표 | 봉인된 release의 얼린 관측 manifest만 받는다. 같은 run 정체성으로 다시 실행하면 저장된 상태를 검증하고 이어 간다 | 재실행이 멱등이다 | ADR 0014, 0015 |
| `capture-reference` | R2 코드 파일, `run`·`request_unit`·`raw_blob`·`raw_observation`, `source_release`(+`_dataset`·`_run`·`_observation`) | `capture`와 같은 저장 경계이되 파일 하나가 release 하나이며 즉시 봉인한다 | 파일 = release | ADR 0035 |
| `project-reference` | `core.code_release`·`code_release_member`·`code_value`·`code_label_observation` | 한 transaction. Argo mutex `eatbid-core-publication`(공고 투영과 같은 `code_value`를 두고 경합하지 않게) | 활성 code release는 하나다 | ADR 0035 |
| `capture-code-vocabulary` | R2 eaT 코드목록 응답, `run`·`request_unit`·`raw_blob`·`raw_observation`, `source_release`(+`_dataset`·`_run`·`_observation`) | `capture`와 같은 저장 경계이되 왕복 하나가 release 하나다. 응답 모양 검사는 raw 보존 뒤·봉인 전에 한다 | 왕복 = release | EAT-187 |
| `project-code-vocabulary` | `core.code_value`(유효기간·사용 여부)·`code_label_observation` | 한 transaction. Argo mutex `eatbid-core-publication`(공고 투영과 같은 `code_value`를 두고 경합하지 않게). `code_release`를 만들지 않는 이유는 mart 지역 축이 release의 존재를 체계 전환 신호로 읽기 때문이다 | 라벨의 증거는 그 코드목록 관측이다 | EAT-187, ADR 0034 |

## 3. 모듈별 쓰기 대상

검사기가 읽는 표다. 같은 모듈이 여러 단계에 나오면 합집합이 그 모듈의 대상이며, 모듈 경로는
`apps/dataplane/src/eatbid/` 기준이다.

| 단계 | 모듈 | 쓰는 곳 |
|---|---|---|
| discover | `ingest/postgres_run_planning.py` | `ingest.run`, `ingest.request_unit` |
| discover | `ingest/postgres_release_repository.py` | `ingest.source_release`, `ingest.source_release_dataset`, `ingest.source_release_run`, `ingest.source_release_observation` |
| discover, capture | `ingest/postgres_repository.py` | `ingest.raw_blob`, `ingest.raw_observation`, `ingest.request_unit`, `ingest.run` |
| capture | `ingest/postgres_hold_repository.py` | `ingest.source_hold` (소스가 우리를 막았을 때의 결정 "언제까지 부르지 않는다". 사실이 아니라 결정이라 뷰로 파생할 수 없다. discover·next-backfill-window는 읽기만 한다, ADR 0055) |
| discover, capture, capture-reference, capture-code-vocabulary | `storage/r2_store.py` | `R2 raw/{source}/{endpoint}/{sha256}.{xml\|txt}.gz` |
| check-expectations | `monitoring/store.py` | `R2 monitoring/{환경}/expectation-state.json` (ADR 0054 이후 쓰지 않는다. 표가 비어 있을 때 한 번 읽어 이관하는 원본으로만 남았다) |
| check-expectations | `monitoring/ledger.py` | `monitoring.violation`, `monitoring.notification` (위반의 수명과 보낸 통. 열린 행은 환경·키당 하나, 해소 행은 이력으로 보존, 전송 실패도 행. ADR 0054) |
| check-expectations | `monitoring/round.py` | `monitoring.round` (회차당 한 행의 모양 지표. 판정·알림이 끝난 뒤 쓰며 알림의 근거가 아니다, EAT-227) |
| capture, validate | `ingest/postgres_release_guards.py` | `ingest.source_release_observation`, `ingest.source_release_dataset` |
| normalize, replay | `ingest/postgres_normalization_repository.py` | `ingest.normalization_attempt`, `ingest.normalization_attempt_record`, `ingest.normalized_record` |
| validate, replay | `ingest/postgres_publication_repository.py` | `ingest.publication`, `ingest.publication_record`, `ingest.run` |
| validate, fail-release, capture-reference, capture-code-vocabulary | `ingest/postgres_release_sealing.py` | `ingest.source_release`, `ingest.run` |
| replay | `ingest/postgres_replay_repository.py` | `ingest.run`, `ingest.replay_input`, `ingest.publication` |
| project, replay | `core/postgres_repository.py` | `ingest.publication`, `ingest.run` |
| project, replay | `core/postgres_projection_writer.py` | `core.organization`, `core.organization_identifier`, `core.auction_attempt`, `core.auction_revision`, `core.auction_organization`, `core.auction_revision_code_value` |
| project, replay | `core/postgres_lineage_writer.py` | `core.auction_attempt_link`, `core.auction_attempt` |
| project, replay | `core/postgres_roster_writer.py` | `core.bid_submission`, `core.award_decision` |
| project, replay | `core/postgres_supplier_writer.py` | `core.source_supplier_account`, `core.supplier_party` |
| project, replay, project-reference, project-code-vocabulary | `core/postgres_code_values.py` | `core.code_value`, `core.code_label_observation` |
| project-reference | `core/code_release_projection.py` | `core.code_release`, `core.code_release_member` |
| project-code-vocabulary | `core/code_vocabulary_projection.py` | `core.code_value`, `core.code_mapping` (소스가 코드목록에서 말한 상위 코드를 parent 관계로. 시군구 → 시도, EAT-260) |
| build-marts | `mart/postgres_repository.py` | `mart.build`, `mart.build_coverage` |
| build-marts | `mart/build_coverage.py` | `mart.build_coverage` |
| build-marts | `mart/org_round_summary.py` | `mart.org_round_summary`, `mart.org_round_summary_item` |
| build-marts | `mart/item_bridge.py` | `mart.build_vocabulary_gap` (스냅샷·회차 요약 빌더가 넘긴 다리표 insert를 실행하고 어휘 밖 조각을 센다, EAT-256) |
| build-marts | `mart/win_rate_distribution.py` | `mart.win_rate_distribution_monthly` |
| build-marts | `mart/open_auction_snapshot.py` | `mart.open_auction_snapshot`, `mart.open_auction_snapshot_item`, `core.auction_attempt` |
| reap-marts | `mart/reaper.py` | `mart.org_round_summary`, `mart.win_rate_distribution_monthly`, `mart.open_auction_snapshot`, `mart.build_coverage` (시한이 지난 superseded build의 행 회수. 원장 build 행은 쓰지 않는다, EAT-254) |

### 진입점에 연결되지 않은 writer

| 단계 | 모듈 | 쓰는 곳 |
|---|---|---|
| 없음 | `core/region_mapping_projection.py` | `core.code_mapping` |
| 없음 | `core/code_coordinate_projection.py` | `core.code_value_coordinate` |

두 모듈은 통합 테스트만 부르고 어떤 CLI 명령에서도 닿지 않는다(2026-09-10 조사, EAT-125). 마이그레이션
seed도 두 표에 행을 넣지 않으므로 운영 DB의 `core.code_mapping`·`core.code_value_coordinate`는 이 경로로는
채워지지 않는다. 연결할지 삭제할지는 별도 issue에서 정한다. 그때까지 검사기는 이 두 행으로 소스와
지도를 맞춘다.

## 4. 누가 읽는가

- API(`apps/server`)는 `core`·`mart`·`app`만 읽는다. `ingest`를 읽는 server 코드는 테스트뿐이다
  (2026-09-10 grep). 1절의 역할 모델과 같다.
- mart build는 `core`와 함께 `ingest.publication`·`publication_record`·`normalized_record`(발행이 실은
  record type)와 `ingest.run`(수집 mode)을 읽고, `open_auction_snapshot`은 봉인된 release의 목록 관측을
  R2에서 다시 읽는다.
- 운영 SQL([runbook §4](../operations/collection-runbook.md))은 `ingest`를 직접 읽는다.

## 5. 생성된 ERD

- [`ingest`](generated/erd-ingest.md) · [`core`](generated/erd-core.md) · [`mart`](generated/erd-mart.md) ·
  [`app`](generated/erd-app.md)
- 원천은 `packages/db/drizzle/<최신 마이그레이션>/snapshot.json`이다. Drizzle 마이그레이션을 만든 커밋에서
  `pnpm architecture:erd:write`를 실행해 함께 커밋한다. `architecture:check`의 `db-erd`가 drift를 실패시킨다.
