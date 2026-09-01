# Task 4 구현 보고 — discovery와 production CLI composition

## 결과

- eaT `bid-list` discovery를 stable `TOT_CNT`, exact page 크기, bounded page budget, 숫자 canonical source ID와 정렬 manifest로 닫았다.
- 모든 성공 목록 page는 `raw object archive → raw observation record → source release observation attach` 순서를 지킨다.
- discovery 전체 계약을 통과한 뒤에만 release를 계획하고 run/observation membership과 dataset progress를 붙여 봉인한다.
- `discover`, `capture`, `normalize`, `validate`, `project`, `replay` CLI가 실제 `Application` method로 dispatch되며 모든 명령이 UUID `--source-release-id`를 요구한다.
- live eaT·R2·PostgreSQL·Infisical·Kubernetes 호출 없이 recording client, memory raw store와 PostgreSQL testcontainer만 사용했다.

## TDD 증거

### RED

```text
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_discover.py -q
ERROR: ModuleNotFoundError: No module named 'eatbid.pipeline.discover'

uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_discover.py -q
4 failed, 8 passed
원인: 0, 선행 0, 비 ASCII, 20자리 초과 source ID가 거부되지 않음

uv run --project apps/dataplane pytest apps/dataplane/tests/integration/test_cli_pipeline.py -q
ERROR: ModuleNotFoundError: No module named 'eatbid.pipeline.discovery_persistence'

uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_cli.py -q
ERROR: cannot import name 'COMMAND_HANDLERS' from 'eatbid.cli'

uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_cli.py -q
ERROR: No module named 'eatbid.composition'
```

### GREEN

```text
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_discover.py apps/dataplane/tests/unit/test_cli.py apps/dataplane/tests/integration/test_cli_pipeline.py -q
28 passed

uv run --project apps/dataplane pytest apps/dataplane/tests -q
631 passed

uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests
All checks passed!

uv run --project apps/dataplane pyright apps/dataplane/src
0 errors, 0 warnings, 0 informations

fnm exec --using=24.20.0 node --version
v24.20.0

fnm exec --using=24.20.0 pnpm architecture:check
exit 0
```

첫 architecture 실행은 새로 touch된 기존 Python 모듈 세 곳의 `모듈 책임:` docstring 누락을 검출해 실패했고, 책임 문장만 추가한 뒤 같은 exact Node gate가 통과했다.

## 명령 계약과 exit code

공통 입력은 `--run-id UUID`, `--source-release-id UUID`, `--build-sha SHA-256`, `--parser-version`이다.

| 명령 | 추가 필수 입력 | 실제 application 경계 | 성공 출력 |
|---|---|---|---|
| `discover` | release name, as-of, 시작/완료 시각, 조회 시작/종료일 | list HTTP→raw archive→observation→release plan/member/progress/seal | exit `0` |
| `capture` | external bid ID, 시작 시각 | reviewed detail request→raw archive→observation→release member | exit `0` |
| `normalize` | observation ID, 정규화 시각 | release observation membership 확인→`normalize_observation` | exit `0` |
| `validate` | publication ID, 검증 시각 | sealed release 확인→`validate_run` | exit `0` |
| `project` | publication ID, 활성 시각 | sealed release 확인→`project_publication` | exit `0` |
| `replay` | publication/observation ID, 네 stage 시각 | sealed release 확인→`replay_observations` | exit `0` |

stderr에는 provider message나 traceback을 쓰지 않고 bounded category만 쓴다. 예상 밖/구성 실패 `64`, `DATA_QUARANTINED` `65`, `SOURCE_THROTTLED` `75`, `SOURCE_CONTRACT` `76`이다.

## raw-first persisted state

첫 page는 run expected request count `1`로 시작한다. 각 HTTP 응답은 object store 보존 성공 뒤 observation으로 기록된다. 모든 page의 `TOT_CNT`, page 크기, 중복, 최종 합계와 budget을 검증한 뒤 captured page 수로 run expected count를 `1 → N` 한 번만 확정한다. 그 다음 release를 계획하고 run과 정렬된 page observation을 붙인 뒤 dataset progress를 exact count로 기록하고 봉인한다.

중간 parser/count/duplicate/budget/transport 실패에서는 이미 저장된 raw object와 observation을 보존하고 run을 typed failure로 끝낸다. release는 전체 page 검증 뒤에만 계획하므로 이 경로에서 partial release와 seal은 0건이다. budget 초과는 첫 page의 `TOT_CNT`로 필요 page 수를 계산한 직후, 다음 HTTP 전에 실패한다.

## port와 권위 변경

- `IngestRepository.finalize_run_expected_count`: 최초 raw page 기록 중 count 불변식을 깨지 않고, 전체 discovery 뒤 exact page request 수를 한 번 확정하기 위해 추가했다. PostgreSQL 구현은 active run, exact captured count, bootstrap 값 `1`을 parent lock 아래 검증한다.
- `SourceReleaseRepository.require_observation_member` / `require_sealed`: downstream CLI가 `source_release_id`를 장식 인수로 무시하지 않고 exact raw member와 sealed 상태를 fail-closed하도록 추가했다.
- `capture_response`: 이미 transport에서 받은 응답도 기존 raw archive→observation 경계를 재사용하도록 추출했다.
- eaT registry가 `record_type`, page/detail parameter builder를 소유한다. CLI/composition/discovery에는 endpoint URL, method, header, Nexacro field와 fingerprint literal을 복제하지 않았다.

## secret redaction과 lifecycle

`ApplicationSettings`는 DB/R2 credential을 `SecretStr`와 `repr=False`로 감추고 validation error input을 숨긴다. DB DSN, R2 endpoint/bucket/credential, connect/read/write/pool timeout과 page budget을 bounded validation한다. 단위 테스트는 `repr`, `ValidationError`, composition failure와 CLI stderr 어디에도 fixture credential이 나타나지 않음을 확인했다.

`Application`은 HTTP client와 DB connection을 한 곳에서 소유하며 정상/본문 예외 경로 모두 정확히 한 번 닫는다. construction 실패 때 생성된 DB connection도 닫고 provider detail을 cause/context로 넘기지 않는다.

## 파일 길이

모든 touch 파일은 300줄 이하다. 기존 대형 adapter는 책임별로 나눴다.

- `postgres_repository.py` 226줄, `postgres_run_planning.py` 186줄
- `postgres_release_repository.py` 299줄, `postgres_release_guards.py` 46줄
- `composition.py` 247줄, `discover.py` 238줄
- 최대 test 파일 `test_eat_registry.py` 263줄

## 남은 우려

- 이 Task는 offline discovery/release와 실제 command wiring까지만 검증했다. live credential과 canary는 별도 승인 전까지 실행하지 않았다.
- `capture`는 호출 시점에 수정 가능한 planned release가 있어야 하며 sealed discovery release에 member를 추가하려 하면 의도대로 실패한다. 여러 run의 detail corpus를 묶는 후속 release orchestration은 EAT-19 이후 범위다.

---

## 2차 적대 리뷰 수정 — 동일 release lifecycle

기존의 discovery 직후 list-only release 봉인은 제거했다. 한 `source_release_id` 아래에 목록 page만 소유하는 discovery run과 발견된 상세 요청만 소유하는 detail run을 둔다. 첫 목록 raw를 보존·해석한 직후 정수 올림으로 page 수를 계산하고 discovery run의 expected request count를 `1 → N`으로 확정한 뒤에만 두 번째 HTTP를 허용한다. 목록 완료 뒤 discovery run은 `validated`, detail run은 `running`, composite release는 `planned` 상태다.

정렬된 `ELCTRN_BID_ID`마다 detail run의 `bid-detail` request unit을 먼저 영속화한다. 이 exact request-unit 집합이 frozen canonical 발견 manifest이며 CLI 출력은 `source_release_id`, `detail_run_id`, `discovered_count`, canonical JSON SHA-256만 반환한다. 목록 dataset의 normalized count는 이 영속 집합 생성 뒤에만 기록한다. `capture`는 release·detail run·ID에 정확히 대응하는 `planned` unit 한 건만 읽으므로 임의 ID나 다른 run을 추가할 수 없다.

`normalize`는 release observation, detail run, raw observation이 같은 corpus인지 함께 검증한다. `validate` 경계는 captured detail unit, attached raw observation, 실제 normalization attempt의 normalized/quarantined 상태를 PostgreSQL에서 다시 집계한 뒤 detail dataset progress를 기록하고 release를 봉인한다. 봉인 manifest 조회도 모든 observation의 run membership을 같은 terminal transaction에서 재검증한다. `project`는 publication/run/release와 publication record corpus를, `replay`는 모든 요청 observation membership을 fail-closed로 검증한다.

### 2차 TDD 증거

RED는 production 변경 전에 다음 focused 실행으로 기록했다.

```text
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_discover.py -q
6 failed
원인: DiscoveryPlan에 detail_run_id가 없고 기존 discover가 즉시 봉인함
```

GREEN과 최종 gate는 다음과 같다.

```text
uv run --project apps/dataplane pytest apps/dataplane/tests/unit/test_cli.py apps/dataplane/tests/unit/test_discover.py apps/dataplane/tests/integration/test_cli_pipeline.py -q
23 passed

uv run --project apps/dataplane pytest apps/dataplane/tests -q
626 passed

uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests
All checks passed!

uv run --project apps/dataplane pyright apps/dataplane/src
0 errors, 0 warnings, 0 informations

git diff --check
exit 0

fnm exec --using=24.20.0 node --version
v24.20.0

fnm exec --using=24.20.0 pnpm architecture:check
exit 0
```

통합 테스트는 live 외부 서비스 없이 PostgreSQL testcontainer, memory raw store, fixture source client로 discovery → 같은 release의 preplanned detail capture → exact membership normalize → DB-derived reconcile/seal → publication validate와 corpus guard를 실행한다. 별도 run/publication 거부, page 2 중복 시 page 3 미호출, 3-page expected count 선확정, 0건 wire, 거대 `TOT_CNT`, provider/DB secret context 제거, R2 구성 실패 시 HTTP→DB 역순 단일 close도 확인한다.

### 수정된 명령 계약

- `discover`는 기존 인수에 `--detail-run-id UUID`가 추가되며 bounded JSON manifest 식별자를 stdout으로 반환한다.
- `capture`는 `--source-release-id`, `--run-id`, `--external-bid-id`의 exact preplanned unit만 소비하고 observation ID/content hash JSON을 반환한다.
- `normalize`는 동일 release/run에 붙은 detail observation만 처리한다.
- `validate`가 실제 terminal detail corpus를 재집계하고 그 release만 봉인한 뒤 publication을 검증한다.
- `project`와 `replay`는 sealed 상태만 보지 않고 publication/observation corpus를 release에 대조한다.
- exit code는 구성/예상 밖 `64`, quarantine `65`, throttled `75`, source contract `76`을 유지한다. best-effort failure ledger와 cleanup 실패는 원래 typed 오류의 message/repr/cause/context를 바꾸지 않는다.

### 2차 파일 길이와 우려

수정 파일은 모두 300줄 이하다. 주요 파일은 `discover.py` 272줄 이하, `composition.py` 259줄, `postgres_release_guards.py` 193줄, `postgres_run_planning.py` 206줄, 통합 테스트 158줄이다.

실제 eaT/R2/운영 PostgreSQL은 호출하지 않았다. `reconcile_and_seal`의 progress 갱신과 seal은 각각 parent lock을 사용하며, terminal seal transaction이 모든 observation의 run membership을 다시 검증한다. request unit은 observation 수를 1로 제한하고 normalization attempt는 run/observation/parser unique이므로 두 transaction 사이에 exact detail count를 부풀리는 경로는 닫혀 있다.
