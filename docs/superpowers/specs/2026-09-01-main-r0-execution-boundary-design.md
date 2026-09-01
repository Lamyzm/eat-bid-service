---
status: accepted
date: 2026-09-01
linear_issue: EAT-15
canonical_for: main-authority-and-r0-execution-boundary
supersedes: none
---

# 원격 main 권위와 R0 실행 경계 설계

## 1. 목적

이 문서는 저장소 권위 전환과 R0 분석 데이터 기반 구축을 실제 변경 전에 고정한다. 두 작업은 서로 다른
rollback point를 가지지만, R0 산출물이 하나의 검증된 Git SHA에서 만들어져야 하므로 다음 순서를 지킨다.

```mermaid
flowchart LR
    authority[원격 main 권위 확립] --> contract[R0 릴리스 계약]
    contract --> offline[오프라인 source 경계]
    offline --> canary[라이브 canary]
    canary --> corpus[전체 raw 릴리스·core publication]
    corpus --> mart[정책 중립 mart build]
    mart --> eat6[EAT-6 cohort 정책]
    eat6 --> eat7[EAT-7 제품 수직 슬라이스]
```

이 문서의 승인은 설계 승인이다. 원격 branch, GitHub 설정, credential, R2, PostgreSQL, Kubernetes, Argo,
실데이터를 변경하는 권한은 포함하지 않는다. 각 외부 변경은 저장소 검증과 정확한 대상 확인 뒤 별도 승인을
받는다.

승인된 실행계획은 다음 순서로 읽는다.

1. `docs/superpowers/plans/2026-09-01-main-authority-migration.md`
2. `docs/superpowers/plans/2026-09-01-r0-source-release-and-offline.md`
3. `docs/superpowers/plans/2026-09-01-r0-live-canary.md`
4. `docs/superpowers/plans/2026-09-01-r0-government-code-releases.md`
5. `docs/superpowers/plans/2026-09-01-r0-canonical-corpus-and-publication.md`
6. `docs/superpowers/plans/2026-09-01-r0-policy-neutral-mart-and-handoff.md`

## 2. 확인된 현재 상태

2026-09-01 로컬·원격 조회와 저장소 파일을 기준으로 확인한 사실은 다음과 같다.

| 영역 | 현재 상태 | 위험 |
|---|---|---|
| 로컬 권위 | 로컬 `main`은 `404722e`, 데이터 기반 branch는 이미 조상 commit | 원격에 같은 권위가 없음 |
| 원격 권위 | 기본 branch와 `origin/HEAD`는 `master`; `origin/main`은 없음 | 로컬 작업과 CI·배포 SHA가 갈림 |
| 검증 CI | `validate.yml`은 `main` push와 모든 PR을 검증 | 원격 기본 branch와 불일치 |
| publication CI | `build.yml`, SLSA, Cosign identity, promotion push가 `master` 고정 | 일부만 바꾸면 서명 신뢰가 깨짐 |
| Argo CD | `targetRevision: master`, `path: infra/k8s/base` | 실제 product composition인 `infra/product`와 불일치 |
| dataplane | raw-first, normalize/quarantine, frozen publication과 replay 기반은 구현 | live transport·CLI composition·Argo proof는 미실행 |
| eaT 계약 | `bid-detail`의 `ds_info`, `ds_areaList`에서 `auction.v1`만 정규화 | 제출·순위·낙찰 결과가 분석 corpus에 없음 |
| mart | PostgreSQL namespace만 있고 build/table 계약은 없음 | EAT-6가 참조할 `mart_build_id`를 발행할 수 없음 |

`master` publication과 `main` validation을 그대로 병행하지 않는다. 두 branch가 동시에 publish할 수 있는
기간을 만들면 같은 서비스 tag와 promotion commit의 권위가 둘로 갈린다.

## 3. 결정 1: 원격 main을 유일한 저장소 권위로 전환한다

### 3.1 전환 불변식

- 원격 `main`은 검토된 로컬 `main`의 exact SHA에서 시작한다. force push하지 않는다.
- PR required check와 publication workflow는 역할을 분리한다. PR은 read-only 검증만 하고 image publication과
  promotion은 보호된 `main`의 trusted workflow만 수행한다.
- workflow trigger, job guard, SLSA protected ref, Cosign certificate identity, promotion checkout/push를 한 변경
  단위로 전환한다.
- `master`에는 전환 중 새 commit이 들어오지 않게 보호한다. 관찰 기간 전에는 삭제하지 않는다.
- Git의 Argo Application manifest와 cluster에 이미 존재하는 Application은 별도 상태다. manifest를 바꿨다는
  이유만으로 live cluster 전환이 완료됐다고 보고하지 않는다.
- rollback은 GitHub default/protection, publication identity, Argo target을 같은 권위로 함께 돌린다. 일부만
  되돌리는 rollback은 금지한다.

### 3.2 실행 순서

| 단계 | 변경 | 통과 증거 | 실패 시 조치 |
|---|---|---|---|
| A0 기준점 봉인 | 원격 `master` SHA, 로컬 `main` SHA, clean tree, 현재 default/protection/check를 기록하고 복구용 immutable ref를 만든다 | 두 SHA와 설정 snapshot이 worklog에 남음 | 변경 없이 중단 |
| A1 원격 main 생성 | 검토된 로컬 `main`을 새 `origin/main`으로 push한다 | 원격 SHA가 기준점과 일치 | 새 branch만 제거하거나 기준점으로 복원 |
| A2 main 보호 | `main`에 PR, force-push 금지, `아키텍처·테스트·빌드 검증`과 `프론트엔드 browser 기반 검증`을 required check로 둔다 | 실제 GitHub check 이름과 rule 조회 결과 | 기존 default는 유지하고 rule 수정 |
| A3 권위 전환 PR | publication trigger/guard, SLSA/Cosign, promotion target, hard-coded test와 문서를 `main`으로 바꾼다. Argo manifest는 `main`과 검증된 `infra/product`를 가리킨다 | PR validation green, master literal architecture test green | PR을 merge하지 않음 |
| A4 단일 publication | `master` write를 동결하고 A3를 merge해 `main`에서 signed image와 provenance를 한 번 발행한다 | image digest, certificate identity, provenance Git SHA, promotion commit이 모두 `main` | publication을 중지하고 A0 권위 세트로 복원 |
| A5 기본 branch 전환 | GitHub default를 `main`으로 바꾸고 clone/PR base/required check를 다시 조회한다 | `origin/HEAD → main`, 새 PR base가 main | default를 master로 복원 |
| A6 Argo cutover | repository manifest와 cluster Application의 branch/path를 `main`/`infra/product`로 맞춘다 | rendered product, desired Git SHA, promoted digest, Argo sync 결과 일치 | Argo target과 publication 권위를 A0 세트로 복원 |
| A7 관찰 | 최소 한 번의 후속 검증·promotion·Argo reconciliation을 관찰한다 | dual publication 없음, drift 없음 | master 삭제 없이 원인 수정 |

`infra/argocd/application.yaml`의 현재 `infra/k8s/base`는 workflow와 migration을 포함하지 않는 legacy 경로다.
A3에서는 `kubectl kustomize infra/product`와 delivery test가 통과해야만 path를 바꾼다. A6 전에는 schedule을
활성화하지 않는다.

## 4. 결정 2: R0는 “전체”가 아니라 versioned 분석 최소 corpus다

R0의 첫 분석용 데이터 묶음 이름은 `R1 analysis-minimum corpus release`로 정한다. “eaT 전체 데이터”처럼
검증할 수 없는 표현을 쓰지 않고 다음을 릴리스 계약에 고정한다.

- source와 endpoint/dataset registry
- 수집 기간, 기준시점 `as_of`, 포함·제외 조건
- request unit/page manifest와 dataset별 expected/observed count
- parser·normalized contract·schema fingerprint version
- raw object content hash와 observation membership
- 필수/선택 dataset, quarantine와 미확정 mapping 처리

첫 릴리스의 필수 canonical 사실은 다음과 같다.

| 사실군 | 필요한 이유 | 현재 상태 |
|---|---|---|
| `AuctionAttempt`와 revision | 모든 분석의 target과 시간축 | `auction.v1` 일부 구현 |
| 구매기관과 source identifier | exact 기관 이력과 reconciliation | 이름·일부 코드만 존재 |
| 지역·품목·방식 코드 release/mapping | cohort 조건을 문자열 추론 없이 구성 | 기반 schema는 있으나 live release 없음 |
| `BidSubmission`·참가자·순위·관측 비율 | 실제 과거 관측 분포 | source evidence에는 있으나 정규화하지 않음 |
| `AwardDecision`·결과 finality | 종료·확정된 outcome 판정 | canonical 계약 없음 |
| 기초·예정·투찰·낙찰 금액과 rate 의미 | 단위가 섞이지 않는 재현 계산 | 일부 amount만 구현 |

선택 dataset이 빠질 수는 있지만 계약에 선택으로 선언하고 EAT-6 cohort dimension에서 제외해야 한다. 필수
dataset 누락, silent row drop, 미지원 schema, required mapping quarantine가 남은 릴리스는 analysis-ready가 아니다.

## 5. 결정 3: 실행 ID와 데이터 릴리스 ID를 분리한다

현재 `run_id`는 한 번의 capture/replay 실행이며 실패와 재시도를 포함한다. EAT-6가 재현 가능한 입력 집합을
가리키려면 실행과 독립된 first-class 릴리스 manifest가 필요하다.

| 식별자 | 의미 | 불변 조건 |
|---|---|---|
| `run_id` | capture/replay 한 번의 실행 | 재시도마다 새 ID, 기존 run 보존 |
| `source_release_id` | exact raw observation 집합을 봉인한 분석 입력 릴리스 | source/dataset/window/as_of/member hash가 같아야 같은 릴리스 |
| `publication_id` | 한 source release를 versioned contract로 검증해 core에 원자 발행한 결과 | required member 누락 시 published 금지 |
| `mart_build_id` | exact publication set과 computation version으로 만든 정책 중립 build | 입력·코드 version이 같으면 결과 hash 결정적 |

`source_release_id`는 여러 성공 run과 replay input을 membership으로 가질 수 있다. release를 봉인한 뒤 member를
수정하지 않으며 정정·추가 수집은 새 release를 만든다. 이 식별자의 DDL과 상태 전이는 구현 전에 별도 ADR로
승인한다. 단일 `run_id`를 raw release 별칭으로 사용하는 축약안은 재시도와 부분 backfill을 한 분석 입력으로
묶을 수 없어 채택하지 않는다.

```text
planned source release
  → raw members verified and sealed
  → normalized members complete
  → core publication validated and published
  → policy-neutral mart build validated and activated
```

각 전이는 append-only evidence를 남긴다. 실패 build와 이전 active build는 보존하고, 부분 결과로 마지막 검증
snapshot을 덮어쓰지 않는다.

## 6. 결정 4: EAT-6 전에는 정책 중립 base mart만 만든다

R0에서 cohort level, sample threshold, fallback, histogram bin, drift 기준을 미리 고정하지 않는다. 첫 production
정책은 전체 검증 corpus의 탐색 profile과 시간순 OOS 검증 뒤 EAT-6에서 version으로 발행한다.

base mart의 grain은 `AuctionAttempt × selected AuctionRevision × observed submission/outcome`의 사실 행이다.
각 행은 canonical ID, source release/publication, raw observation, selected revision, observed/effective time,
meaningful amount/rate unit과 quality state를 역추적한다. 기관명·금액·낙찰업체 같은 source fact를 mart가 두 번째
권위로 복사하지 않고 core ID를 참조한다.

base mart에는 다음을 넣지 않는다.

- cohort fallback과 sample threshold
- 추천값·추천범위·승률
- UI 전용 label·색상·정렬 정책
- 미관측 예정가격 계산과 미래 정보
- 이름 또는 복합 문자열로 만든 임시 identity

## 7. 라이브 실행은 canary 뒤에만 확대한다

| 단계 | 범위 | 필수 증거 |
|---|---|---|
| B0 릴리스 계약 | dataset registry, identity ADR, completeness query | 고정 manifest fixture와 실패 상태 전이 |
| B1 오프라인 source | list/detail discovery, parser dispatch, CLI composition | fixture replay, schema drift, raw-first, exit code |
| B2 라이브 canary | 작은 기간·page budget, manual Argo Workflow, schedule suspended | R2 hash, DB run/release/publication, quarantine, deterministic replay |
| B3 canonical 확장 | submission/award/code 계약과 projector | source fixture부터 core lineage까지 한국어 테스트 |
| B4 전체 backfill | 승인된 기간의 모든 필수 request unit | dataset별 completeness와 재시도 후 같은 release hash |
| B5 core publication | 검증된 release의 원자 발행 | publication ID, reconciliation, 미발행 row 격리 |
| B6 base mart | 정책 중립 fact build | mart build ID, input set, computation version, 결정성 hash |
| B7 EAT-6 handoff | coverage/freshness/quarantine와 lineage 보고서 | EAT-6 본문에 실제 ID와 queryable evidence 연결 |

B2는 eaT/R2/PostgreSQL/Infisical/Kubernetes를 변경하므로 설계 승인만으로 실행하지 않는다. canary가 실패하면
full backfill로 우회하지 않고 schedule은 계속 suspended로 둔다.

## 8. EAT-14 분할안과 소유 경계

EAT-14는 umbrella로 유지하고 이 문서 승인 후 다음 독립 issue로 분할한다. 한 issue가 source adapter, DDL,
mart, GitHub/Argo 설정을 동시에 소유하지 않는다.

| work item | 책임 | 주요 소유 경로 | 선행 |
|---|---|---|---|
| EAT-16 저장소 권위 전환 | A0~A7와 rollback evidence | `.github/workflows`, `infra/argocd`, provenance/test/docs | EAT-15 승인 |
| EAT-17 release identity ADR | `source_release_id`와 completeness 상태 전이 | `docs/adr`, `docs/architecture` | EAT-15 승인 |
| EAT-18 offline eaT source | discovery/transport/CLI와 registry | `apps/dataplane/src/eatbid/source/eat`, CLI, tests | EAT-17 |
| EAT-19 live canary 운영 | Infisical delivery, R2/DB, manual Workflow evidence | `infra/product/secrets`, workflows, operations docs | EAT-16, EAT-18 |
| EAT-20 정부 코드 release | MOIS/NEIS release, 기관 reconciliation과 coverage | contracts/db/reference adapters | EAT-17 |
| EAT-21 submission canonical | portable 계약·Drizzle·projector | contracts/db/dataplane의 submission files | EAT-19, EAT-20 |
| EAT-22 award canonical | result finality 계약·Drizzle·projector | contracts/db/dataplane의 award files | EAT-21 |
| EAT-23 full release/publication | backfill, reconciliation, atomic publish | dataplane pipeline/operations | EAT-20~22 |
| EAT-24 policy-neutral mart | base fact DDL/build/lineage | `packages/db` mart, dataplane mart builder | EAT-23 |
| EAT-25 EAT-6 handoff | coverage 보고서와 실제 ID 연결 | product/operations docs, Linear worklog | EAT-24 |

portable registry와 Drizzle migration이 겹치는 정부 code·submission·award issue는 EAT-20→21→22로 직렬화한다. 각 issue는 lease를
잡기 전에 owned path를 적고, 공유 registry 수정자는 한 시점에 하나만 둔다.

## 9. EAT-6 Ready 조건

EAT-6는 다음이 모두 충족될 때만 Ready로 옮긴다.

1. R0 담당 umbrella와 완료된 child issue가 EAT-6에 연결돼 있다.
2. sealed `source_release_id`, published `publication_id`, validated `mart_build_id`가 실제 저장소에서 조회된다.
3. 각 ID가 source dataset, request unit, raw hash, parser/contract, canonical revision까지 역추적된다.
4. 필수 dataset completeness, 기간·`as_of`, freshness, quarantine, unresolved mapping, field coverage 보고서가 있다.
5. 기관·품목·지역·방식·금액·결과 finality 등 후보 cohort dimension의 관측률이 숫자로 측정돼 있다.
6. 동일 입력 재실행의 member/build hash가 일치하고 미래 observation이 과거 build를 바꾸지 않는다.
7. active build 전환과 이전 build 복원이 검증됐으며 부분 publication이 API/UI에 노출되지 않는다.

EAT-6는 이 증거를 바탕으로 cohort policy와 임계값을 사전등록한다. EAT-7은 EAT-6가 발행한
`cohort_policy_id`, `mart_build_id`, `analysis_result_id`를 소비할 때 시작한다.

## 10. 이 설계의 완료 조건

- 원격 `main` 전환이 단일 publication 권위와 일관된 rollback 세트로 정의돼 있다.
- `run_id`, `source_release_id`, `publication_id`, `mart_build_id`의 책임이 겹치지 않는다.
- R0의 필수 corpus가 auction detail만으로 축소되지 않고 submission·award·code 의미를 포함한다.
- live canary 전에 offline source와 release completeness를 검증하며 schedule은 마지막까지 suspended다.
- EAT-6 전에 cohort 정책을 섞지 않는 base mart 경계가 고정돼 있다.
- EAT-14를 겹치지 않는 writer와 검증 가능한 handoff 단위로 분할할 수 있다.
