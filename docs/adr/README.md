---
id: ADR-INDEX
status: active
canonical_for: architecture-decision-record-index
last_reviewed: 2026-09-11
review_trigger: adr-status-vocabulary-or-supersession-rule-change
---

# Architecture Decision Records

ADR은 이미 내린 결정과 그 대가를 보존한다. 목표 구조를 바꾸려면 기존 파일을 소급 수정하지
말고 새 ADR을 작성해 `Supersedes` 관계를 명시한다.

상태는 `Proposed`, `Accepted`, `Deprecated`, `Superseded` 중 하나다.

| ADR | 상태 | 결정 |
|---|---|---|
| [0001](0001-greenfield-reset.md) | Accepted | 그린필드 재설계와 선택적 자산 보존 |
| [0002](0002-product-north-star.md) | Accepted | 분석 엔진 + 다사업자 운영 워크스페이스 (경계 조항 중 예측가 항목은 [0027](0027-predicted-win-probability-in-scope.md) 이 뒤집음) |
| [0003](0003-single-monorepo.md) | Accepted | `eat-bid-service` 단일 모노레포 |
| [0004](0004-data-authority-chain.md) | Accepted | R2 raw → PostgreSQL core/app → mart 권위 사슬 |
| [0005](0005-postgresql-canonical-store.md) | Accepted | PostgreSQL canonical, canonical Parquet 보류 |
| [0006](0006-identifiers-and-code-schemes.md) | Accepted | 내부 ID와 source-scoped code scheme |
| [0007](0007-argo-runtime-boundary.md) | Accepted | Argo CD 배포, Argo Workflows 실행, 단일 scheduler |
| [0008](0008-modular-monolith.md) | Accepted | web/server/dataplane 3 deployable과 모듈러 모놀리스 |
| [0009](0009-drizzle-owns-ddl.md) | Accepted | Drizzle migration이 유일한 DDL 경로 |
| [0010](0010-append-only-observations-and-revisions.md) | Accepted | append-only 관측/revision과 원자적 발행 |
| [0011](0011-versioned-derived-analytics.md) | Accepted | 분석은 버전된 재생성 가능 파생물 |
| [0012](0012-security-observability-and-recovery-baseline.md) | Accepted | 초기 보안·관측·복구 기준 |
| [0013](0013-drizzle-v1-release-lane.md) | Accepted | Drizzle v1 RC 단일 release lane |
| [0014](0014-normalization-attempt-lineage.md) | Accepted | immutable raw evidence → run-scoped normalization attempt → frozen publication member |
| [0015](0015-canonical-projection-lineage.md) | Accepted | normalized interpretation → canonical revision 직접 lineage와 원자 projection |
| [0016](0016-nest-effect-application-boundary.md) | Accepted | Nest lifecycle·Effect 실행·Drizzle repository·HTTP 횡단 관심사 경계 |
| [0017](0017-greenfield-server-composition-reset.md) | Accepted | 탐색용 server route를 새 composition에 싣지 않고 inventory+Git 이력으로 보존 |
| [0018](0018-application-identity-and-id-wire-format.md) | Accepted | provider subject→bigint principal 경계와 무손실 bigint HTTP 인코딩 |
| [0019](0019-nest12-runtime-without-cli.md) | Accepted | Nest 12 runtime은 채택하되 불가능한 CLI/TypeScript peer lane은 분리 |
| [0020](0020-semantic-values-temporal-zod-contracts.md) | Superseded | 의미 있는 값 타입, Temporal 시간 모델, Zod wire 계약 |
| [0021](0021-zod-portable-contract-hub.md) | Accepted | Zod portable contract hub와 Python 생성 계약 |
| [0022](0022-infisical-secret-value-authority.md) | Accepted | Infisical 비밀값 SSOT와 로컬·CI·Kubernetes 전달 경계 |
| [0023](0023-nextjs-web-modular-boundaries.md) | Accepted | Next.js Web 모듈 경계와 계약 소비 (legacy 공존의 baseline 운영은 [0042](0042-legacy-ledger-retirement-and-changed-scope-checks.md)가 대체) |
| [0024](0024-free-github-tag-gated-publication.md) | Accepted | 무료 GitHub tag 기반 publication gate |
| [0025](0025-source-release-manifest.md) | Accepted | source release manifest와 봉인된 raw membership |
| [0026](0026-provider-neutral-ai-review-and-canonical-skills.md) | Accepted | provider 중립 AI advisory 리뷰, Claude 구독 폴백, canonical Agent Skill 위치 |
| [0027](0027-predicted-win-probability-in-scope.md) | Accepted | 예측 승률을 판단 재료로 경계 안에 (추천가·자동 투찰은 밖에 유지) |
| [0028](0028-cache-components-and-self-hosted-cache.md) | Accepted | Cache Components 조건부 활성화, Suspense 격리, replica 1 in-memory cache와 `use cache` 소유 경계 |
| [0029](0029-eat-v2-bid-list-contract.md) | Accepted | `eat-v2` 상세 계약에 `ds_bidList` 블록 (`eat-v1` 은 유지) |
| [0030](0030-competitor-count-is-the-primary-material.md) | Accepted | 화면의 주인공을 경쟁자 수와 승률 곡선으로 (학교별 추이는 내리지 않고 자리만 뒤로) |
| [0031](0031-decision-screen-frontend-rendering.md) | Accepted | 결정 화면의 상태 소유(nuqs)·직접 그린 차트·headless 표·측정 후 가상화 |
| [0032](0032-authentication-and-authorization-boundary.md) | Accepted | 인증·인가 경계: Nest가 Better Auth(Google)를 마운트, principal bigint, 역할 owner\|member, 명시적 계정 초기화, 등록된 사업자는 워크스페이스 안에서만 유일하고 core 연결은 조회가 파생 |
| [0033](0033-bid-submission-partitioning-and-supplier-core.md) | Accepted | 투찰·낙찰·업체 core 테이블 다섯, `core.bid_submission`의 개찰 연도 range 파티션, `auction.v2` 발행 개방 (§1의 계정→party 영구 링크 전제는 [0049](0049-supplier-identity-is-observed-per-submission.md)가 대체) |
| [0034](0034-mart-build-identity-and-atomic-activation.md) | Accepted | `mart.build` 빌드 원장, partial unique index 활성 포인터와 상태 trigger, mart 단위 전량 재빌드, build 속성으로서의 지역 코드 체계 |
| [0035](0035-administrative-region-canonical-and-mapping.md) | Accepted | 행정안전부 법정동코드 canonical, 시도·시군구 grain, release별 계층, 별도 표의 좌표, 증거 기반 eaT 매핑 (재선언 ledger는 [0042](0042-legacy-ledger-retirement-and-changed-scope-checks.md)로 철거) |
| [0036](0036-read-cache-tags-and-invalidation-owner.md) | Accepted | 결정 화면 읽기 캐시의 안정 태그 어휘, dataplane이 부르는 web `/internal/cache/revalidate`, 유계 `cacheLife` (0031 7항 대체) |
| [0037](0037-poll-open-detail-refetch-policy.md) | Accepted | poll-open 상세 재호출을 목록 신호 넷(`BID_CNT`·상태·마감·변경시각)의 변화와 마감 전이로 좁히고, 기준은 마지막 봉인 release, 강제 전량 재호출은 daily-reconcile |
| [0038](0038-additive-ingestion-fields-and-parser-version.md) | Accepted | 봉인된 수집 계약의 optional 가산 확장(`exclude_unset` canonical 재직렬화), `location.eligibilityAreas`, 라벨을 싣는 파서는 새 version `eat-v3` (0014·0025·0029 refine) |
| [0040](0040-observed-rates-in-organization-history.md) | Accepted | 기관 이력의 낙찰·차순위 사정률은 ObservedBidRate로 보존하며 하한율의 100 상한은 유지(0033 §2 일부 대체) |
| [0041](0041-attempt-roster-read-and-observed-amount.md) | Accepted | 회차 명단의 동일 revision 조회와 EFT_ALL_AMT 관측 제출금액 표시, 계산용 원천 금액 분리 |
| [0042](0042-legacy-ledger-retirement-and-changed-scope-checks.md) | Accepted | 삭제 전용 legacy ledger 넷 철거, merge-base 변경 범위 검사와 파일 머리 `@boundary-waiver`, 병렬 단일 드라이버 `architecture:check`와 `--changed` pre-commit (0020·0023·0035의 ledger 조항 대체) |
| [0043](0043-session-lock-and-commit-boundary-guard.md) | Accepted | agent workflow 가드를 명령 가로채기 lease에서 worktree 세션 잠금(holder)과 pre-commit·pre-push의 branch↔claim 검사로 바꾸고, 명령 분류기·lease 만료·writer 결박을 삭제 (2026-08-30 workflow 설계 §4.1·§6과 0026 결정 3의 허용 목록 운영 대체) |
| [0044](0044-route-segment-slice-structure.md) | Accepted | route segment 내부를 `_features/<name>/{ui,model,lib}`와 `_widgets/`로 나누고 `lib`의 React·`model`의 JSX·`ui`의 비렌더 모듈을 검사하며, 두 화면 이상이 쓰는 도메인 표시 조각을 위한 `entities/` 층을 둔다 ([0023](0023-nextjs-web-modular-boundaries.md)의 segment private 조항과 층 목록을 보완) |
| [0045](0045-server-module-presentation-seam.md) | Accepted | 서버 모듈 안에서 wire 직렬화는 `presentation/http/*.presenter.ts`, 모듈 공통 wire 도우미는 `platform/http/wire.ts`, 캐시·재시도 장식자는 `infrastructure/<concern>/`, 모듈 공통 실패는 모듈 이름, 경계 숫자는 domain 상수가 소유한다 |
| [0046](0046-telemetry-wire-correlation-and-alert-origin.md) | Accepted | 계측은 OpenTelemetry 규격, 상관 식별자는 W3C trace context, 파이프라인 진실은 PostgreSQL이고 지표는 파생물이라 업무 알림은 DB에서 내며, 멈춤은 기대 문장으로 잡고 생존 확인만 클러스터 밖에 둔다 (저장·대시보드·프론트 오류 도구는 교체 가능한 자리) |
| [0047](0047-relative-import-depth-and-alias-resolution.md) | Accepted | 상대 경로 import는 `../` 한 단계까지, 별칭은 각 패키지의 module 체계가 이미 소유한 해석기(`apps/web`의 `@/`)만 쓰고 나머지는 구조로 해결하며, 해석기가 없는 `apps/server`·`packages/contracts`는 module format 정리를 조건으로 검사에서 뺀다 (판정은 [0042](0042-legacy-ledger-retirement-and-changed-scope-checks.md)의 변경 범위) |
| [0048](0048-workspace-region-preference-on-eat-eligibility-areas.md) | Accepted | 워크스페이스 관심 지역을 eaT 참가제한지역 코드로 저장(행안부 canonical은 유지하고 매핑은 미룸), 계층은 조회가 아니라 선택 시점의 입력 보조, 제한지역 미관측은 목록에 남기고 표본 수를 매칭·미관측으로 분해, 저장 전 실제 조회 미리보기 |
| [0049](0049-supplier-identity-is-observed-per-submission.md) | Accepted | 사업자번호는 계정의 영구 속성이 아니라 투찰 시점의 관측이며, 계정→party 영구 링크를 없애고 그 시점의 party를 투찰이 소유한다 (0033 §1의 영구 링크 전제를 대체하고 party 유일 키는 유지) |
| [0050](0050-verification-authority-and-merge-gate.md) | Accepted | `main`은 서버가 보호하고 병합 판정은 CI 하나만 하며, 검증은 질문이 다른 세 고리(작업 중·병합 전·릴리스)로 나뉘고 같은 검사를 두 고리에서 돌리지 않는다 (0024의 권한 근거를 대체하고 태그의 prod publication 결론은 유지) |
| [0051](0051-dev-overlay-and-unsigned-main-image-lane.md) | Accepted | manifest를 `infra/base` + `infra/envs/{dev,prod}`로 가르고 이미지 레인을 둘(`main` 병합의 비서명 dev 레인, 태그의 서명 prod 레인)로 나누며 dev는 소스를 부르지 않는다 |

## 새 ADR 형식

```markdown
# NNNN — 제목

- Status: Proposed
- Date: YYYY-MM-DD
- Supersedes: 없음

## Context
## Decision
## Consequences
## Rejected alternatives
```
