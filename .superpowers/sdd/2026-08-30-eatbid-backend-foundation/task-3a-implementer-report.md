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
