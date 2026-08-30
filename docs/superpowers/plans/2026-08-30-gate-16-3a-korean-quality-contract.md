# Gate 16.3a Korean Quality Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 백엔드의 비자명한 경계 판단을 한국어 주석으로 보존하고, TypeScript/Python 테스트 명세가 한국어를 포함하도록 AST 기반 CI 계약을 만든다.

**Architecture:** 루트 `tools/quality`가 TypeScript compiler AST와 Python 표준 `ast`를 각각 사용해 테스트 선언만 검사한다. 검사는 기존 `architecture:check`와 루트 테스트에 연결하고, 실제 테스트 제목/함수명만 의미 보존 방식으로 변경하며 assertion과 fixture는 건드리지 않는다.

**Tech Stack:** Node.js 24, TypeScript compiler API 5.9.3, Python 3.12 `ast`, Node test runner, Bun test, pytest

**Spec:** `.superpowers/sdd/2026-08-30-eatbid-backend-foundation/task-3-brief.md`와 현재 Gate 16.3a 위임

## Global Constraints

- 모든 직접 TypeScript `describe`/`test`/`it` 제목과 Python pytest `test_*` 함수명은 한글 음절을 하나 이상 포함한다.
- TypeScript aliases, `only`/`skip`/`todo`/`each`, `describe.each` 우회를 검사하고 동적 제목은 fail-closed 한다.
- 테스트명 변경은 assertion, 실행 동작, fixture를 변경하지 않는다.
- production 주석은 도메인 불변식, 보안/트랜잭션/수명주기 경계와 선택 이유만 설명하고 코드를 반복하지 않는다.
- 다른 Gate의 기능, DB DDL, API 동작, 배포 계약은 변경하지 않는다.

---

### Task 1: AST 기반 테스트 명세 검사

**Files:**
- Create: `tools/quality/check-test-names.test.mjs`
- Create: `tools/quality/check-test-names.mjs`
- Create: `tools/quality/check-python-test-names.py`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TEST_NAMES_ROOT`로 지정한 저장소 루트, `apps/server`의 exact TypeScript compiler
- Produces: 위반 시 파일/행/이유를 출력하고 1로 종료하는 `pnpm quality:check`

- [ ] **Step 1: 실패하는 검사기 계약 테스트 작성**

  임시 저장소 fixture에 직접 호출, import/변수 별칭, `only`/`skip`/`todo`/`each`, 동적 제목, Python 함수명을 구성하고 한글 제목만 허용한다. fixture 소스가 테스트 파일의 문자열 안에 있어도 자기 자신을 오탐하지 않는지 검증한다.

- [ ] **Step 2: RED 확인**

  Run: `node --test tools/quality/check-test-names.test.mjs`
  Expected: 검사기 파일 부재로 실패한다.

- [ ] **Step 3: 최소 AST 검사 구현**

  TypeScript AST는 테스트 API 별칭과 호출 체인을 해석하고 직접 문자열/무치환 template만 허용한다. Python helper는 `ast.FunctionDef`/`ast.AsyncFunctionDef`의 `test_` 이름만 검사한다.

- [ ] **Step 4: GREEN 확인 및 루트 명령 연결**

  Run: `node --test tools/quality/check-test-names.test.mjs`
  Expected: 모든 우회/허용 fixture가 통과한다.

### Task 2: 저장소 테스트 명세 소급 변환

**Files:**
- Modify: repository TypeScript test files
- Modify: repository Python pytest files
- Modify: `tools/architecture/check-stack-docs.test.mjs`

**Interfaces:**
- Consumes: Task 1 검사기 위반 목록
- Produces: 의미를 유지하는 한국어/기술 식별자 병기 테스트 명세

- [ ] **Step 1: 현재 저장소에서 품질 검사를 실행해 RED 위반 수 기록**

  Run: `pnpm quality:check`
  Expected: 기존 영문 제목/함수명을 모두 보고하고 실패한다.

- [ ] **Step 2: 제목/함수명만 기계적으로 변경**

  영어 기술 식별자는 유지하되 행위 동사를 한국어로 옮긴다. Python 함수명을 직접 참조하는 곳은 같은 rename map으로 갱신한다.

- [ ] **Step 3: GREEN 확인**

  Run: `pnpm quality:check`
  Expected: 위반 0건이다.

### Task 3: 문서와 production 경계 주석

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/architecture/backend-application-foundation.md`
- Modify: non-test production files under `apps/server/src`, `packages/contracts/src`, `packages/db/src/schema`

**Interfaces:**
- Consumes: 기존 아키텍처 경계와 현재 구현
- Produces: 변경 가능 값 대신 불변식과 선택 이유를 설명하는 한국어 TSDoc/why 주석

- [ ] **Step 1: 규칙 문서화**

  테스트 명세의 한국어 원칙과 production 경계 주석 기준, 금지되는 반복/수 채우기 주석을 명문화한다.

- [ ] **Step 2: production 코드 감사 및 주석 추가**

  공개 포트/계약/컨트롤러, 요청·종료 수명주기, schema/권한/transaction, bigint 변환 경계에만 주석을 추가한다. barrel/index와 자명한 선언은 제외한다.

- [ ] **Step 3: diff로 비동작 변경임을 확인**

  Run: `git diff --word-diff=porcelain -- apps/server/src packages/contracts/src packages/db/src/schema`
  Expected: 테스트명 외 production 변경은 주석뿐이다.

### Task 4: 전체 검증, 보고서, 단일 커밋

**Files:**
- Create: `.superpowers/sdd/2026-08-30-eatbid-backend-foundation/task-3a-implementer-report.md`

**Interfaces:**
- Consumes: Tasks 1-3 전체 변경
- Produces: RED/GREEN 수치, 전체 검증 결과, 단일 구현 커밋

- [ ] **Step 1: 전체 TypeScript/Python 테스트와 정적 검증 실행**

  Run: `pnpm test`, server e2e/integration, dataplane+infra pytest, Ruff, Pyright, `pnpm architecture:check`, `pnpm build`.

- [ ] **Step 2: 보고서 작성 및 명시적 staging**

  RED/GREEN 위반·테스트 수와 경고를 기록하고 `git add -- <명시적 파일>`만 사용한다.

- [ ] **Step 3: 단일 커밋 생성 및 커밋 상태 확인**

  Run: `git commit -m "chore(quality): enforce Korean test specifications"` 후 `git status --short`.
  Expected: 작업 트리가 깨끗하고 커밋 하나가 생성된다.
