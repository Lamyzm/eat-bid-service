# eatbid 정언명령

이 파일은 이 저장소에서 작업하는 모든 사람과 AI 세션의 최상위 작업 계약이다.
구현을 시작하기 전에 반드시 [`ARCHITECTURE.md`](ARCHITECTURE.md)와
[`docs/architecture/README.md`](docs/architecture/README.md)를 읽어라.

## 절대로 어기지 말 것

1. **하나의 진실 원천을 소유권별로 하나만 둔다.** 원본 증거는 R2의 불변 raw 객체,
   해석된 업무 사실은 PostgreSQL `core`, 사용자 작성 상태는 PostgreSQL `app`만 권위가 있다.
   `mart`와 캐시는 언제든 다시 만들 수 있는 파생물이다.
2. **문자열을 정체성으로 쓰지 않는다.** 이름·주소·화면 라벨·복합 문자열을 PK, FK,
   URL 식별자, 조인 키로 쓰지 마라. 외부 코드는 `(source_system, code_scheme, code)`로
   수신하고 내부에서는 숫자 ID로 참조하라.
3. **관측과 해석을 분리한다.** 원본을 먼저 보존한 뒤 파싱한다. 파싱 실패, 미확인 코드,
   불완전 응답을 추측으로 메우지 말고 격리하라. `unknown`은 유효한 상태다.
4. **공고를 재입찰까지 포함한 시도 단위로 기록한다.** `AuctionAttempt`가 업무 사실의
   중심이며 재공고·차수는 문자열 접미사가 아니라 원본 관계로 연결한다.
5. **학교를 보편 모델로 삼지 않는다.** 구매기관은 `Organization`, 참여 업체는
   `SupplierParty`다. 학교·유치원·어린이집·교육청·공공기관은 기관 유형일 뿐이다.
6. **지역 코드 체계를 섞지 않는다.** eaT 공고지역, eaT 참가제한지역, 행정안전부
   행정구역, NEIS 학교 코드는 별개의 `CodeScheme`이다. 명시적 매핑 없이는 같다고 보지 마라.
7. **분석은 사실에서 재현 가능해야 한다.** 모든 지표에 표본 수, 코호트/기간, 원본
   릴리스 또는 실행, 계산 버전, 산출 시각을 남겨라. 분석 JSON을 기준정보 테이블에 넣지 마라.
8. **예측가·추천가·자동 투찰을 만들지 않는다.** 제품은 판단 재료와 운영 상태를 제공한다.
   NeaT 입력과 최종 의사결정은 사용자의 행위다.
9. **Argo CD는 배포하고 Argo Workflows는 실행한다.** 크롤링·백필·재처리는 동일한
   WorkflowTemplate에서 실행한다. Kubernetes CronJob이나 별도 스케줄러를 병존시키지 마라.
10. **DDL 작성자는 Drizzle 하나뿐이다.** `packages/db` 스키마에서 마이그레이션을 생성해
    커밋한다. 운영에서 `db:push`, 수기 `schema.sql`, ConfigMap DDL을 사용하지 마라.
11. **모듈러 모놀리스를 유지한다.** 배포 단위는 `web`, `server`, `dataplane` 세 개다.
    측정된 병목이나 독립 수명주기가 없는 한 마이크로서비스·Kafka·검색 클러스터를 추가하지 마라.
12. **레거시 호환성을 새 설계에 전염시키지 않는다.** 그린필드 전환에서 보존할 것은
    원본 XML, 검증된 외부 식별자/불변식/테스트, 소스 접근 지식, 명확히 매핑되는 사용자 상태뿐이다.
13. **백엔드의 판단 경계는 한국어로 이유를 남긴다.** 공개 port/계약, 도메인 불변식,
    인증·권한·transaction·수명주기, BigInt 무손실 변환처럼 잘못 바꾸면 사고가 되는 선택에는
    TSDoc 또는 why 주석을 둔다. 코드를 문장으로 반복하거나 현재 숫자·목록을 복사하거나 주석 수를
    채우기 위한 설명은 금지하며, barrel/index와 자명한 선언에는 억지 주석을 달지 않는다.
14. **테스트 이름은 사람이 읽는 한국어 명세다.** TypeScript `describe`/`test`/`it`의 직접 문자열
    제목과 Python pytest `test_*` 함수명은 한글 음절을 포함해야 한다. HTTP, Effect, PostgreSQL 같은
    기술 식별자는 영문을 병기할 수 있지만, 동적 제목이나 별칭으로 품질 검사를 우회하지 않는다.
15. **값의 의미와 단위를 원시값에 숨기지 않는다.** 시간은 Temporal과 주입된 Clock, 금액은 통화를
    동반한 exact decimal, 비율은 percentage-point와 ratio를 구분한 타입, 수량·바이트·좌표는 목적과
    단위가 드러나는 타입을 사용한다. canonical interchange와 공개 API wire 표현은
    `packages/contracts`의 Zod schema가 권위이며, Python normalized model은 versioned JSON Schema에서
    생성한다. reviewed source parser/fingerprint와 known-column source Pydantic, Drizzle DDL은 각자의
    권위를 유지한다. `Date`·일반 `number`·문자열로
    계층 경계를 암묵 통과시키지 않는다.
16. **계약은 Zod native composition으로 조립한다.** atom→value→중첩 resource→versioned endpoint
    순서를 유지한다. 같은 contract family는 `pick`/`omit`/`safeExtend`를 사용할 수 있지만 ingestion,
    command, public response, DB row 사이를 서로 `pick`하지 않는다. 최종 DTO의 반복적인 shape spread,
    object intersection, parallel interface, schema 조립용 Immer/별도 framework를 만들지 않는다.
17. **계약 topology와 의미 값 gate를 우회하지 않는다.** application `AuctionRecord`는 내부 port이며
    공개 응답은 Zod에서 추론한 `AuctionV1Response`다. portable registry graph에는 codec·transform/overwrite·runtime
    custom predicate를 넣지 않으며 registry와 exported top-level `portableContracts` root 자체도 필수다.
    `Temporal.Now`는 `packages/domain/src/time/clock.ts`의 top-level `systemClock`,
    PostgreSQL driver `Date | string`은
    `apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts`의 `AuctionRow`와
    top-level `postgresInstant`만 허용한다. web/shared 기존 부채는 exact AST fingerprint ledger에서 삭제만
    허용한다.
18. **300줄을 넘는 코드 파일은 책임 분리를 검토한다.** 새 기능을 더하기 전에 도메인 책임,
    port/adapter, schema 계층, UI 역할, 테스트 fixture처럼 함께 변경되는 이유가 다른 경계를 우선
    추출하라. 줄 수만 맞추는 기계적 분리는 금지한다. 하나의 응집된 알고리즘, 생성 코드, 선언형
    schema·fixture처럼 분리가 더 해로우면 유지할 수 있지만 작업 보고서에 그 이유를 한 문장으로 남겨라.
19. **공개 endpoint는 operation 계약에서만 정의한다.** method, version, semantic path와 입력,
    status별 응답/Problem schema, `operationId`는 `packages/contracts`의 resource operation이 소유하고
    Nest decorator, OpenAPI와 Web request path는 여기서 파생하라. Server/Web source에 canonical
    `/api/v1/...` literal이나 frontend `ENDPOINTS` mirror를 만들지 마라. API origin은 runtime config,
    Next 화면 URL은 `app/` file-system과 generated route type, Server Action은 import 가능한 mutation이
    소유한다. `/api/**`는 Nest ingress이며 Web-owned public handler는 별도 owner contract, non-`/api`
    prefix와 ingress rule 없이는 만들지 않는다. 이 경계를 검사하는 repository endpoint lint를 새 canonical operation과 같은 변경에서
    추가하고, baseline 예외를 넓혀 우회하지 않는다.
20. **하나의 work item에는 한 명의 writing owner만 둔다.** 파일을 쓰기 전에 Linear issue를
    assign하고 검증된 worktree lease를 claim하라. 첫 mutation session이 lease의 writer가 되며,
    의도한 owned path는 issue/handoff에 남긴다. 다른 writer가 claim한 작업은 read-only로
    조사·review만 한다. 병렬 구현은 별도 issue·worktree에서 owned path가 겹치지 않을 때만 허용한다.
21. **이 저장소는 한국어 프로젝트이며 사람이 읽는 기본 언어는 한국어다.** 에이전트의 작업 계획·진행 보고와
    아키텍처·ADR·spec·plan·README, 이슈·PR·worklog, 코드의 이유 주석, 테스트명과 커밋 메시지는 한국어로
    작성한다. 코드 식별자, 라이브러리·프로토콜
    고유명, CLI 명령, 외부 공식 인용과 원문 오류처럼 정확성을 위해 필요한 부분은 영문을 유지할 수
    있지만 설명 본문까지 영문화하지 않는다. 기존 영문 문서는 무관한 대량 번역을 하지 않고 실질적으로
    수정할 때 한국어로 전환한다.
22. **AI 리뷰는 결정적 gate 뒤의 읽기 전용 advisory다.** Codex와 Claude 모두 저장소의
    `pnpm review:ai`를 사용하고 별도 도구 전용 품질 규칙을 만들지 않는다. AI finding은 자동 수정하거나
    lint·typecheck·test·contract·architecture 실패를 덮을 수 없다. 실행 경계와 장애 처리는
    [`docs/operations/ai-code-review.md`](docs/operations/ai-code-review.md)를 따른다. 반복 절차의
    canonical Agent Skill은 `.agents/skills`이며 `.claude/skills`는 `pnpm agent:skills:write`가 만든
    projection이라 직접 편집하지 않는다.
23. **production 모듈은 책임을 한국어로 먼저 설명한다.** 신규·실질 변경 JavaScript/TypeScript 모듈은
    directive와 import·실행 코드보다 앞에 `@module 책임:` 주석을, Python 모듈은 첫 docstring에
    `모듈 책임:`을 둔다. 함께 바뀌는 이유와 소유 경계를 구체적으로 한 문장으로 적고 “이 모듈을 설명한다”
    같은 장식 문구를 쓰지 않는다. 테스트·fixture·생성물·순수 barrel·선언형 config/schema는 제외하며,
    기존 부채는 `e7fdcd2`와 byte가 같은 삭제 전용 ledger만 허용한다. `pnpm quality:check`를 우회하지 않는다.

## 변경 절차

- 아키텍처 경계를 바꾸기 전에 관련 ADR을 새로 작성하거나 대체 ADR로 갱신하라.
- 데이터 모델 변경은 `domain-and-data.md`, 런타임 변경은 `runtime-and-deployment.md`,
  시스템 경계 변경은 `c4.md`와 `arc42.md`를 같은 변경에서 갱신하라.
- 새 코드 체계는 먼저 `CodeScheme`의 소유기관·버전·유효기간·매핑 정책을 정의하라.
- 수집 단계는 raw 저장 성공 전에 canonical 행을 공개하지 마라.
- 부분 수집 결과로 현재 공개 뷰를 덮어쓰지 마라. 검증된 실행 단위로 원자적으로 발행하라.
- 구현보다 추적성, 재실행 안전성, 실패 가시성을 우선 검증하라.
- 테스트 이름만 바꿀 때 assertion·fixture·실행 순서를 함께 고치지 마라. 명세 번역과 동작 변경은
  서로 다른 검토 단위로 유지하라.
- 계약이나 의미 값을 바꾼 뒤 `pnpm architecture:check`, `pnpm contracts:check`,
  `pnpm contracts:python:check`를 check mode로 실행하라. CI에서 drift 확인 전에 pnpm/uv frozen install을
  완료하며 check mode는 추적된 생성물을 다시 쓰지 않는다.

## 필수 읽기 순서

1. [`ARCHITECTURE.md`](ARCHITECTURE.md) — 목표와 문서 지도
2. [`docs/architecture/product-and-quality.md`](docs/architecture/product-and-quality.md) — 제품 범위와 품질 기준
3. [`docs/architecture/domain-and-data.md`](docs/architecture/domain-and-data.md) — SSOT와 정규화 모델
4. [`docs/architecture/c4.md`](docs/architecture/c4.md) — 시스템/컨테이너/컴포넌트 경계
5. [`docs/architecture/runtime-and-deployment.md`](docs/architecture/runtime-and-deployment.md) — Argo 실행·배포 모델
6. [`docs/architecture/arc42.md`](docs/architecture/arc42.md) — 전체 설계 서술
7. [`docs/adr/README.md`](docs/adr/README.md) — 확정된 결정과 변경 방법
8. [`docs/architecture/time-and-value-contracts.md`](docs/architecture/time-and-value-contracts.md) — 시간·단위·portable Zod 계약

기존 `docs/SPEC-*`, `docs/ARCH-*`, `infra/k8s/base/schema.sql`, 현재 DB 구조와 URL은
현행 조사 자료일 뿐 목표 아키텍처가 아니다. 충돌하면 이 파일과 Accepted ADR이 우선한다.
