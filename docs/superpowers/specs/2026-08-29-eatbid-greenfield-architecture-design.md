# eatbid 그린필드 아키텍처 설계 스펙

- Date: 2026-08-29
- Status: Approved for architecture documentation
- Scope: 목표 아키텍처와 전환 경계. 구현 계획/코드 변경은 포함하지 않음.

## 1. 배경

현재 eatbid는 공고/기관/지역/업체를 이름과 복합 문자열로 식별하는 흔적, source code 체계의
혼용, Python/TypeScript 저장소 분리, Parquet/loader/PostgreSQL 중복 권위, 수기 DDL,
Kubernetes CronJob 수집 경로가 겹쳐 있다. 완전 초기 단계이므로 이를 호환하면서 증축하는 대신
입찰 분석과 다사업자 운영이라는 목표에서 기반을 다시 정의한다.

## 2. 승인된 제품 목표

> 정부 원본에 기반한 입찰 분석 엔진과, 그 분석을 공고 발견·다사업자 투찰 준비·결과 복기에
> 연결하는 급식 입찰 운영 워크스페이스.

핵심 업무 grain은 `Workspace × legal SupplierParty × AuctionAttempt`다. 추천 투찰가,
예정가 예측, 자동 NeaT 투찰은 비목표다. 사용자가 eatbid에 적어둔 값, 사용자의 NeaT 입력 확인,
source에서 관측된 실제 submission은 별도 사실이다.

## 3. 선택한 구조

### 데이터 권위

```text
eaT source
  → R2 immutable raw evidence
  → PostgreSQL ingest metadata/quarantine
  → PostgreSQL core canonical facts
  ├→ PostgreSQL app user-authored state
  └→ PostgreSQL mart versioned derived analytics
```

raw는 capture-before-parse, content-addressed, observation append-only다. canonical revision은
검증된 실행에서만 원자 발행한다. mart는 버전/표본/기간/기준시점/원본 실행을 가지며 재생성 가능하다.

### 정체성

외부 정부 코드는 `(source_system, code_scheme, code)` 경계에서 text로 보존하고 내부 관계는
bigint PK/FK로 연결한다. 이름·주소·라벨·복합 문자열은 identity, join, URL key가 아니다.
eaT 공고지역, eaT 참가제한 PDLC, 행정안전부 행정구역, NEIS 학교 코드는 별도 scheme이며
근거와 유효기간이 있는 mapping으로만 연결한다.

### 도메인

- `AuctionAttempt`와 append-only `AuctionRevision`, source 기반 `AuctionRelation`
- 학교에 한정하지 않은 `Organization`과 role 기반 `AuctionOrganization`
- 법적 `SupplierParty`와 source 계정 분리
- `BidSubmission`과 `AwardDecision` 분리
- `Workspace × SupplierParty × AuctionAttempt` unique `BidWorkItem`
- 공식 코드가 없는 품목은 versioned Taxonomy/ClassificationRule

### 애플리케이션과 저장소

`eat-bid-service`를 단일 모노레포로 유지하고 Python 자산을 `apps/dataplane`으로 흡수한다.
배포 단위는 Next.js `web`, NestJS modular monolith `server`, Python `dataplane` 세 개다.
Server 모듈은 procurement, institutions, suppliers, eligibility, workspace, intelligence,
contracts, operations다.

### 데이터 작업과 배포

Argo CD는 platform/product를 배포하고 Argo Workflows만 poll/reconcile/backfill/replay를 실행한다.
단일 image의 `discover → capture → normalize → validate → project → mart → verify` DAG를 사용한다.
source semaphore, publication mutex, typed failure, `TOT_CNT` gate, stateless pod, digest/Git SHA pinning을
적용한다. Kubernetes CronJob과 별도 scheduler는 cutover 뒤 제거한다.

### DDL

`packages/db` Drizzle schema만 DDL을 작성하고 생성된 SQL migration을 커밋한다. 운영 `db:push`,
수기 `schema.sql`, ConfigMap DDL을 사용하지 않는다. DB schema와 HTTP contract를 분리한다.

## 4. 채택/보류 기술

지금 채택:

- PostgreSQL, R2, Argo Workflows, Argo CD, Drizzle migration
- pnpm/Turborepo, Python uv/Pydantic/Ruff/Pyright/pytest
- 구조화 JSON log, run/correlation ID, `pg_trgm`, SOPS+age

측정 후 후보:

- CloudNativePG 또는 managed PostgreSQL
- OpenTelemetry Collector, Prometheus/Grafana/Loki
- dbt, read replica, derived Parquet export

현재 제외:

- Kafka, Redis/Celery, Airflow/Dagster, Elasticsearch/OpenSearch, ClickHouse
- Spark, Iceberg/Delta, canonical Parquet lake
- 마이크로서비스, service mesh, Argo Events

## 5. 보존과 폐기

보존 대상은 raw XML, 검증된 source identifier/불변식/fixture/endpoint 지식, 제품 연구,
명확히 source ID에 매핑되는 사용자 상태다. 현재 DB/URL/API/serving table/Parquet loader/string ID/
CronJob은 호환 요구가 아니며 새 구조 검증 뒤 폐기한다. 이관은 이름 매칭이 아니라 충돌 0의
dry-run 보고와 source identity를 요구한다.

## 6. 주요 품질 기준

- silent loss 0, raw-before-parse, `TOT_CNT` exact completeness
- raw observation/parser version까지 canonical/analysis 추적
- deterministic replay와 idempotent rerun
- 부분 성공이 current view를 바꾸지 않는 atomic publication
- `unknown`을 추측으로 메우지 않음
- 열린 공고 source-to-core p95 35분 초기 목표
- 사용자 상태 RPO 1시간, 핵심 서비스 RTO 4시간 초기 목표
- 단일 노드 k3d의 장애 한계를 명시

## 7. 문서 산출물

- 최상위 작업 계약: [`AGENTS.md`](../../../AGENTS.md)
- 아키텍처 진입점: [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)
- 제품/품질: [`product-and-quality.md`](../../architecture/product-and-quality.md)
- 도메인/데이터: [`domain-and-data.md`](../../architecture/domain-and-data.md)
- C4: [`c4.md`](../../architecture/c4.md)
- Argo/배포: [`runtime-and-deployment.md`](../../architecture/runtime-and-deployment.md)
- arc42: [`arc42.md`](../../architecture/arc42.md)
- 전환: [`legacy-disposition.md`](../../architecture/legacy-disposition.md)
- 결정 기록: [`docs/adr`](../../adr/README.md)

## 8. 구현 전 사용자 검토 포인트

이 스펙 승인 후 구현 계획에서 다음 순서를 세분화한다.

1. raw observation/code registry/새 migration foundation
2. Auction/Organization/Supplier canonical projector와 replay
3. Argo WorkflowTemplate 및 publication gate
4. Server 모듈/새 ID API와 핵심 mart
5. Workspace user state와 다사업자 흐름
6. shadow backfill/대조/cutover/레거시 제거

구현 계획을 작성하기 전에 사용자는 특히 제품 grain, 코드 scheme 분리, 초기 SLO/RPO/RTO,
레거시 사용자 상태 이관 범위를 검토한다. 아키텍처 승인만으로 destructive migration이나
레거시 삭제를 실행하지 않는다.
