# EAT-213 공통 분석 계약 구현 계획

> 실행자는 `superpowers:executing-plans` 절차로 아래 검토 단위를 순서대로 진행한다.

**목표:** 시간별 추이·분포·전체 이력이 함께 소비할 필터, 선택지, 표본과 스냅샷 계약을 확정한다.

**구조:** 기존 atom/value를 조립한 additive Zod resource를 추가한다. portable wire에는 실행 검증을
넣지 않고 날짜·범위·표본 정합성 검증은 domain과 계약 경계의 parser로 분리한다. HTTP operation,
DB 스키마, 집계기와 Web 화면은 각 후속 슬라이스가 소유한다.

**기술:** 저장소의 Zod·Temporal·Bun·pnpm을 재사용한다. 별도 라이브러리는 추가하지 않는다.

**명세:** EAT-176/EAT-213의 2026-09-14 합의 및
`docs/product/analysis-common-contracts.md`. 시안 기준은 `g-methods/?revision=region-comparison-2`다.

- 워크트리/브랜치: `.worktrees/eat-213-analysis-contracts` / `eat-213-analysis-contracts`
- 기준: `9d5046c7` (EAT-214 PR #24 포함). 다른 writer의 경로는 변경하지 않는다.
- 공고지역은 eaT 시도·시군구 코드이고 기관 품목 조건은 비교군에 적용하지 않는다.
- 명단은 철회 행을 포함한 관측 명단 행 수다. 음수·비정수·역전을 거부하고 양끝을 포함한다.
- 공고 상세의 현재 attempt는 양쪽에서 제외한다. 기관 상세는 제외 ID가 없다.
- 0건·스냅샷 없음·수집 정도 미확인을 구분한다. 기본 추천값·예측·새 조회 API를 만들지 않는다.

## 1. 필터와 선택지

- [x] `packages/contracts/src/api/v1/analysis/filter.resource.ts`와 `filter-options.resource.ts`에
  기존 ID·KST 날짜·하한율·코드 참조를 조합한다. `index.ts`, package export와 client graph gate도 연결한다.
- [x] `packages/domain/src/analysis/cohort-bounds.ts`에서 Temporal 날짜 범위와 의미 있는 명단 수 경계를
  검증하고 `packages/contracts/src/codecs/analysis.ts`의 parser가 wire와 연결한다.
- [x] 날짜·명단 역전, 잘못된 달력일, 코드 체계 혼합, 한쪽 범위, 현재 공고 제외의 고정 fixture로 검증한다.

## 2. 표본과 스냅샷

- [x] `snapshot.resource.ts`와 `meta.resource.ts`를 추가한다. 스냅샷은 입력 기준·정책 버전과
  이름 붙인 실제 mart 계보를 보존하며 각 build ID가 같다고 가정하지 않는다.
- [x] parser에서 범위·중복 역할·만료 시각·겹침 수를 검증한다. 존재하는 코드와 동일 관측 집합의 증명은
  실제 공급자의 책임이며, wire parse 성공을 데이터베이스 조회 완료로 보고하지 않는다.
- [x] JSON Schema 변환과 경계 fixture, 서로 다른 유효 build, 0건/미발행, 불가능한 겹침을 검사한다.

## 3. 제품 결정·검증·인계

- [x] PDR-0006과 공통 계약 명세를 작성하고 PDR-0005 및 구형 비교집단 명세에 대체 관계를 남긴다.
  아키텍처의 값 계약 문서에 새 resource와 runtime 의미 검증 경계를 연결한다.
- [x] domain/contracts test·build, `architecture:check`, `test:quality`, `contracts:check`,
  `contracts:python:check`를 실행한다. 기존 공개 계약과 생성물은 check mode로 확인한다.
- 전달 절차: 결정적 검사 뒤 commit, `review:ai`, PR 및 Linear 인계를 수행한다. 최신 PR·CI·인계 상태는 Linear EAT-213에 기록한다.

## 시안 대조와 한계

계약만 추가하므로 실제 UI는 변경하지 않는다. 시안의 공통 조건과 두 집단/전체 이력에 필요한 값은
표로 대조한다. 물고기/육류 같은 시안 문자열을 실제 품목 ID로 옮기지 않는다. dev `localhost:3215`는
EAT-214 워크트리에서 계속 열어 두며 새 분석 데이터의 연결 완료를 뜻하지 않는다.

## 검증 결과

- contracts 190건, domain 전체 단위 검사와 타입 검사 통과. 새 분석 계약 14건·domain 경계 2건을 포함한다.
  전국 전체에서 기관 표본이 빠지는 불일치도 수정 전 실패를 확인한 뒤 거부하도록 구현했다.
- domain/contracts build, 수정 source lint, 전체 architecture 18개, JSON Schema/Python 생성물 check mode 통과.
- `test:quality`의 Node 검사 202건 통과. Python은 공용 임시 폴더의 `pytest-current` 접근 거부가 생겨
  같은 Python 검사에 작업별 `PYTEST_DEBUG_TEMPROOT`를 지정해 재실행했고 30건 통과했다.
  검사·보안 옵션을 낮추거나 다른 세션의 임시 파일을 삭제하지 않았다.
- 새 browser export를 실제 계약 manifest와 검사 대상에 추가하면서 품질 검사의 synthetic manifest도 갱신했다.
  기존 금지 import·dist export 판정은 그대로 유지했다.
- 새 operation/DDL/생성물 변경 없음. 실제 분석 API·DB 성능·사용자 화면 연결·유료 인가는 후속 인수 대상이다.
- 최초 AI advisory에서 관측/분포 중 한쪽 build 누락, 15분과 상태 불일치, 선택지 날짜 검증 누락을
  확인했다. 세 경계를 실패 fixture로 재현한 뒤 parser와 domain `analysis/publication-freshness.ts`로
  보완했다. 15분 정확히는 updating, 그 다음 시점은 delayed다. 운영 스케줄러는 추가하지 않았다.
