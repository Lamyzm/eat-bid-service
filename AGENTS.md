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

## 변경 절차

- 아키텍처 경계를 바꾸기 전에 관련 ADR을 새로 작성하거나 대체 ADR로 갱신하라.
- 데이터 모델 변경은 `domain-and-data.md`, 런타임 변경은 `runtime-and-deployment.md`,
  시스템 경계 변경은 `c4.md`와 `arc42.md`를 같은 변경에서 갱신하라.
- 새 코드 체계는 먼저 `CodeScheme`의 소유기관·버전·유효기간·매핑 정책을 정의하라.
- 수집 단계는 raw 저장 성공 전에 canonical 행을 공개하지 마라.
- 부분 수집 결과로 현재 공개 뷰를 덮어쓰지 마라. 검증된 실행 단위로 원자적으로 발행하라.
- 구현보다 추적성, 재실행 안전성, 실패 가시성을 우선 검증하라.

## 필수 읽기 순서

1. [`ARCHITECTURE.md`](ARCHITECTURE.md) — 목표와 문서 지도
2. [`docs/architecture/product-and-quality.md`](docs/architecture/product-and-quality.md) — 제품 범위와 품질 기준
3. [`docs/architecture/domain-and-data.md`](docs/architecture/domain-and-data.md) — SSOT와 정규화 모델
4. [`docs/architecture/c4.md`](docs/architecture/c4.md) — 시스템/컨테이너/컴포넌트 경계
5. [`docs/architecture/runtime-and-deployment.md`](docs/architecture/runtime-and-deployment.md) — Argo 실행·배포 모델
6. [`docs/architecture/arc42.md`](docs/architecture/arc42.md) — 전체 설계 서술
7. [`docs/adr/README.md`](docs/adr/README.md) — 확정된 결정과 변경 방법

기존 `docs/SPEC-*`, `docs/ARCH-*`, `infra/k8s/base/schema.sql`, 현재 DB 구조와 URL은
현행 조사 자료일 뿐 목표 아키텍처가 아니다. 충돌하면 이 파일과 Accepted ADR이 우선한다.
