# Architecture Decision Records

ADR은 이미 내린 결정과 그 대가를 보존한다. 목표 구조를 바꾸려면 기존 파일을 소급 수정하지
말고 새 ADR을 작성해 `Supersedes` 관계를 명시한다.

상태는 `Proposed`, `Accepted`, `Deprecated`, `Superseded` 중 하나다.

| ADR | 상태 | 결정 |
|---|---|---|
| [0001](0001-greenfield-reset.md) | Accepted | 그린필드 재설계와 선택적 자산 보존 |
| [0002](0002-product-north-star.md) | Accepted | 분석 엔진 + 다사업자 운영 워크스페이스 |
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
| [0020](0020-semantic-values-temporal-zod-contracts.md) | Accepted | 의미 있는 값 타입, Temporal 시간 모델, Zod wire 계약 |

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
