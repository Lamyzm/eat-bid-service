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
