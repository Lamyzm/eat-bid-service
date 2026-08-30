# Gate 16.3a 구현 보고서

## 결과

- `AGENTS.md`와 backend foundation 문서에 한국어 판단 경계 주석과 한국어 테스트 명세 원칙을 명문화했다.
- root-owned AST 검사기가 저장소 전체 TypeScript `describe`/`test`/`it`과 Python pytest `test_*` 함수명을 검사한다.
- TypeScript aliases, namespace import, `only`/`skip`/`todo`/`each`, bound `each`, `describe.each`를 추적하며 동적 제목과 증명할 수 없는 간접 별칭은 fail-closed 한다.
- fixture 문자열, 정규식 `.test()`, 일반 객체 `.test()`는 실제 테스트 선언으로 오인하지 않는다.
- 기존 TypeScript 테스트 제목과 Python pytest 함수명을 assertion, fixture, 실행 순서를 바꾸지 않고 한국어 명세로 소급 변경했다. 반복문으로 생성하던 TypeScript 선언은 같은 표와 callback을 사용하는 `test.each` 직접 문자열로 바꿨다.
- backend production 38개 파일에는 공개 port/계약, BigInt 무손실 경계, DB 권한·트랜잭션, evidence/replay identity grain, HTTP 보안, bootstrap/shutdown 수명주기의 판단 이유만 한국어로 기록했다. `git diff --unified=0` 감사 결과 production 변경 중 주석이 아닌 변경 행은 0개였다.
- CI test job checkout에 전체 history를 제공해 고정 legacy commit을 읽는 inventory 회귀 테스트가 remote shallow clone에서도 재현되게 했다. 다른 job이나 CI 동작은 바꾸지 않았다.

## TDD 증거

### RED — 한국어 명세 검사

1. `node --test tools/quality/check-test-names.test.mjs`
   - 구현 전 checker module 부재로 4개 테스트가 모두 실패했다.
2. 실제 저장소 검사 최초 실행
   - `pnpm quality:check`가 기존 영문/동적 선언을 포함해 438건을 보고하며 실패했다.
3. 일반 `.test()` 오탐 회귀
   - `node --test --test-name-pattern='정규식과 객체' tools/quality/check-test-names.test.mjs`가 정규식과 validator 호출 2건을 잘못 보고하며 실패했다.

### GREEN — 한국어 명세 검사

- `pnpm quality:check`
  - TypeScript 선언 230개, Python 선언 246개 통과.
- `pnpm test:quality`
  - AST checker/architecture fixture 11개 통과.

### RED/GREEN — CI legacy commit

- RED: `uv run --project apps/dataplane pytest infra/tests/test_build_contract.py -k '고정_legacy_commit' -q`
  - checkout step에 `with`가 없어 1 failed, 9 deselected.
- GREEN: 같은 명령
  - `fetch-depth: 0` 적용 후 1 passed, 9 deselected.

## 전체 검증

- `pnpm test`: 222 passed
  - root Node quality/architecture tests 11
  - web/shared/db Bun tests 120
  - contracts Bun tests 4
  - server unit/integration/e2e/tool tests 87
- `uv run --project apps/dataplane pytest apps/dataplane/tests infra/tests`: 586 passed
- `uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests infra/update_image_digest.py infra/generate_slsa_provenance.py infra/verify_argo_platform.py infra/tests`: passed
- `uv run --project apps/dataplane pyright apps/dataplane/src`: 0 errors, 0 warnings
- `pnpm architecture:check`: passed; 한국어 명세 230/246 재확인
- `pnpm --filter @eatbid/server architecture:check`: 0 violations
- `pnpm --filter @eatbid/server openapi:check`: passed
- `pnpm db:check`: passed
- `pnpm build`: 5/5 packages passed
- `git diff --check`: passed

## 경고와 범위

- 로컬 Node는 `v24.2.0`이라 저장소 고정값 `24.20.0` engine 경고가 출력됐다. 고정 계약 자체는 바꾸지 않았고 compatibility 테스트는 통과했다.
- 전체 pytest에서 Windows cp949 subprocess reader의 `UnicodeDecodeError` thread warning 1건이 출력됐지만 586개 테스트는 모두 통과했다. 테스트 이름 변경 외 해당 실행 경로는 수정하지 않았다.
- Next build의 workspace root/font fallback 경고는 기존 환경 경고이며 이번 변경 범위가 아니다.
- Better Auth, 신규 DB DDL, frontend 기능, 배포 활성화 등 다른 Gate 구현은 포함하지 않았다.

## 독립 리뷰 수정 1차

### 수정 결과

- TypeScript/JavaScript 검사기를 단일 TypeScript `Program`과 symbol binding 기반으로 바꿨다. 이제 assignment alias, element access, `require()`/dynamic `import()` namespace와 destructuring, import alias, `only`/`skip`/`todo`/`each`를 추적하고 지역 shadowing과 일반 객체 메서드는 테스트 API로 오인하지 않는다.
- `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`를 확장자별 `ScriptKind`로 분석한다. 저장소 검사는 TypeScript/JavaScript 선언 245개와 Python 선언 246개를 확인한다.
- 단순한 한글 장식이나 일반적인 `동작을 검증한다`만 붙인 제목은 거부한다. 기존 테스트명은 assertion, fixture, 실행 순서 변경 없이 주체·조건·결과가 한국어 서술어로 드러나도록 다시 번역했고, Python 직접 참조도 같은 symbol 이름으로 함께 변경했다.
- compatibility 주석에서 변동 release 값을 제거하고 검증된 framework/runtime 조합만 승격한다는 선택 이유만 남겼다. auction reader 주석은 append-only에서 추론하지 않고 이 API view가 최신 저장 revision을 선택한다는 projection 규칙을 정확히 기술했다.
- Python test diff 감사 결과 checker 구현을 제외한 변경 행은 test 함수명과 그 직접 참조뿐이며, production fix diff는 위 두 주석만 바뀌었다.

### TDD 증거

- RED: `node --test tools/quality/check-test-names.test.mjs` — 기존 5개 통과, 신규 4개 실패. 일반 장식 제목, JS 계열 확장자, assignment/element/require/dynamic-import alias, shadowing 구분이 구현되지 않은 상태를 각각 재현했다.
- RED: 강화 fixture에 `동작을 검증한다`/`test_동작을_검증한다`를 추가한 뒤 같은 명령은 8 passed, 1 failed로 일반 문구 단독 사용을 놓치는 문제를 재현했다.
- RED: 실제 `pnpm quality:check`는 기존 일반 장식 이름 약 424건을 보고하며 실패했다.
- GREEN: `node --test tools/quality/check-test-names.test.mjs` — 9 passed.
- GREEN: `pnpm quality:check` — TypeScript/JavaScript 245개, Python 246개 통과.
- GREEN: `uv run --project apps/dataplane pytest apps/dataplane/tests infra/tests --collect-only -q` — 586개 수집.

### 수정 후 전체 검증

- `pnpm test`: 226 passed
  - root quality/architecture 15, web/shared/db 120, contracts 4, server 87
- `uv run --project apps/dataplane pytest apps/dataplane/tests infra/tests -q`: 586 passed, 기존 Windows cp949 subprocess reader warning 1건
- `uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests infra/update_image_digest.py infra/generate_slsa_provenance.py infra/verify_argo_platform.py infra/tests`: passed
- `uv run --project apps/dataplane pyright apps/dataplane/src`: 0 errors, 0 warnings
- `pnpm architecture:check`: passed; 한국어 명세 245/246 재확인
- `pnpm --filter @eatbid/server architecture:check`: 0 violations
- `pnpm --filter @eatbid/server openapi:check`: passed
- `pnpm db:check`: passed
- `pnpm build`: 5/5 packages passed
- 병렬 전체 검증에서는 dev-smoke가 30초 timeout되고 legacy inventory subprocess가 함께 종료됐으나, 두 파일 단독 실행은 3 passed였고 이어서 실행한 직렬 `pnpm test` 전체는 226 passed였다. 코드 회귀가 아닌 검증 프로세스 간 자원 경합으로 구분한다.

## 독립 리뷰 수정 2차

### 수정 결과

- TypeScript/JavaScript 제목은 separator 뒤가 아니라 앞의 한국어 행위를 판정한다. 따라서 `요청을 거부한다 — HTTP 400`처럼 뒤에 기술 식별자만 둔 제목은 허용하고, `한 rejects an unsafe request`처럼 한글 장식 뒤에 영문 행위를 둔 제목은 거부한다.
- Python 이름은 끝의 한글 유무뿐 아니라 남은 영문 행위 동사와 `이다이다`/`된다이다` 같은 중복 어미도 거부한다. `test_rejects_request_거부한다`는 fail-closed하고 `test_HTTP_400_요청을_거부한다`는 허용한다.
- object/nested destructuring assignment의 symbol을 namespace/test/modifier 단계로 재귀 bind한다. array assignment처럼 지원하지 않는 pattern은 간접 별칭 위반으로 남기며, 조건부 write는 기존 test alias를 지우지 않고 별도 위반을 기록해 이후 호출도 검사한다.
- 원래 영문 test 이름과 현재 이름을 파일·선언 순서로 대조했다. `without`/`only`/`idempotent` 관련 39개를 전수 확인하고, 전체 Python 이름 목록도 다시 읽어 의미 역전·기계 번역·중복 어미를 수정했다. 이 round에서 Python test 함수명 140개만 바뀌었고 assertion, fixture, parameter, 실행 코드는 바뀌지 않았다.

### TDD 증거

- RED: `node --test tools/quality/check-test-names.test.mjs` — 7 passed, 3 failed.
  - `한 rejects an unsafe request`와 `test_rejects_request_거부한다`를 놓쳤다.
  - 올바른 `요청을 거부한다 — HTTP 400`을 잘못 거부했다.
  - object/nested destructuring assignment와 conditional alias 호출을 놓쳤다.
- RED: checker 구현 직후 실제 `pnpm quality:check`가 중복 어미와 남은 영문 행위 동사 8건을 보고하며 실패했다.
- GREEN: `node --test tools/quality/check-test-names.test.mjs` — 10 passed.
- GREEN: `pnpm quality:check` — TypeScript/JavaScript 246개, Python 246개 통과.
- GREEN: `uv run --project apps/dataplane pytest apps/dataplane/tests infra/tests --collect-only -q` — 586개 수집.

### 수정 후 전체 검증

- `pnpm test`: 227 passed
  - root quality/architecture 16, web/shared/db 120, contracts 4, server 87
- `uv run --project apps/dataplane pytest apps/dataplane/tests infra/tests -q`: 586 passed, 기존 Windows cp949 subprocess reader warning 1건
- `uv run --project apps/dataplane ruff check apps/dataplane/src apps/dataplane/tests infra/update_image_digest.py infra/generate_slsa_provenance.py infra/verify_argo_platform.py infra/tests`: passed
- `uv run --project apps/dataplane pyright apps/dataplane/src`: 0 errors, 0 warnings
- `pnpm architecture:check`: passed; 한국어 명세 246/246 재확인
- `pnpm --filter @eatbid/server architecture:check`: 0 violations
- `pnpm --filter @eatbid/server openapi:check`: passed
- `pnpm db:check`: passed
- `pnpm build`: 5/5 packages passed
- `git diff --check`: passed
