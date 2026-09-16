---
id: OPS-HANDOFF-DETAIL-MVP-20260915
status: active
canonical_for: detail-mvp-contextless-handoff-20260915
last_reviewed: 2026-09-15
review_trigger: detail-mvp-component-completion-or-agent-handoff
---

# 상세 MVP — 이전 대화 없이 이어받기

구현·프로세스 관측은 2026-09-15 22:15 KST, 인증·Linear 재확인은 같은 날 22:28 KST다.
이 문서는 작업 복구 색인과 승인 맥락이며 새 상태 원장이 아니다.
최신 issue 상태·owner는 Linear, 코드·claim은 Git과 workflow, 검증은 PR/CI가 소유한다.
**사용자가 새 Claude에게 상세 MVP의 구현과 총괄을 넘기려 한다. 기획을 처음부터 다시 받지 말고 확정된 범위에서 이어간다.**

## 1. 첫 판단에 필요한 현재 사실

| 항목 | 확인된 내용 |
|---|---|
| 프로젝트 | `F:/Project/eat-bid-service`, Next.js Web / Nest server / Python dataplane 모노레포 |
| 목표 | 현재 공고를 기준으로 기관과 지역·전국의 실제 낙찰 이력을 비교하는 유료 상세 MVP |
| 완료한 마지막 조각 | EAT-215: 새 상세 상단·공통 필터·두 탭·전체보기 틀. 실제 분석 자료 연결은 미완료 |
| PR | [#26](https://github.com/Lamyzm/eat-bid-service/pull/26), MERGED |
| 병합 commit | `0a0a1c68ee4f1b2599abca6b0f79bb7939caab89` |
| 병합 시각 | 2026-09-15 02:41:13 KST |
| 구현 commit | `c47c31fea8ad8e4916009dcf7e352fd6d00db3ff` |
| 마지막 작업폴더 | `F:/Project/eat-bid-service/.worktrees/eat-215-detail-filters`, branch `eat-215-detail-filters` |
| 로컬 소유권 | 위 작업폴더는 clean, `claim: null`, `holder: null`로 확인. 새 세션에서 재확인 |
| root checkout | 로컬 main은 `1f2d38f5`로 오래됨. root에 `.obsidian/`, `.playwright-mcp/`가 미추적 상태이며 손대지 않았음 |
| remote 확인 | 이번 `git fetch origin` 뒤 origin/main은 위 병합 commit. root main을 최신이라 간주하지 말 것 |
| dev | 3215(Web), 4400(API), 8769(시안)에 현재 listener 없음. 브라우저에 남은 화면은 실행 증거가 아님 |
| Linear | PR #26 병합과 CI를 재확인하고 EAT-215만 Done 전환. 부모와 후속 구현은 미완료 |
| 인증 | 사용자가 Infisical에 다시 로그인한 뒤 조회·claim 성공. 이전 인증 장애 해소 |
| 문서 반영 | [EAT-225](https://linear.app/eatbid/issue/EAT-225), branch `codex/eat-225-detail-handoff`, `.worktrees/eat-225-detail-handoff`. 애플리케이션 구현은 변경하지 않음 |
| 공유 workflow | outbox 84건 관측. 다른 작업을 포함하므로 일괄 `workflow:sync` 금지 |

전달용 외부 묶음의 미적용 패치를 새 작업에서 다시 적용하지 않는다. 이 Git 문서와 저장소에 보존한 캡처가
교대 진입점이며 원문은 아래 링크에서 읽는다. EAT-215 계획의 예전 PID 32968은 현재 실행 중인 dev가 아니다.
루트 checkout에는 다른 Claude holder가 관측됐으므로 새 writer는 그 소스를 수정하지 말고 격리 worktree에서 시작한다.

새 Claude에게 전달할 문구:

> AGENTS.md와 docs/operations/agent-resume.md, docs/operations/handoffs/2026-09-15-detail-mvp.md를 읽고
> 상세 MVP의 총괄과 구현을 이어받아. 최신 Git·Linear·writer를 확인하고 확정된 시안과 계약에서
> 다음 미완료 슬라이스 하나부터 진행해. 기존 API 중복을 조사하고 dev에서 시안과 계속 비교해.

## 2. 사용자가 만들려는 제품과 승인된 방향

사용자는 이미 트래픽 있는 사이트를 운영하지만 광고 수익보다 유료 업무 도구를 만들고 싶어 한다.
대상은 급식 입찰 납품업체의 실무자다. 가족이 쓰는 기존 Python 도구는 경남의 여러 학교 낙찰점을 겹쳐 그리고,
한 기관의 추이를 강조해 1년/6개월/3개월/1개월을 좁혀 보며 판단하는 방식이었다.
이 사용 사례는 출발점이지 검증된 정답이나 예측 모델이 아니다. 숫자의 근거와 비교 조건을 사용자가 쉽게 이해하게 하는 것이 목표다.
요금·매출 목표는 이번 구현의 acceptance가 아니며 결제 기능이나 요금제 개편을 이 작업에 추가하지 않는다.

확정된 화면 방향:

1. 오늘 공고 목록과 상세는 다른 화면이다. 목록을 다시 디자인하지 않는다.
2. Toss Securities를 디자인 기준으로 삼고 기존 **Toss 토큰을 기본값**으로 사용한다.
3. 현재 공고 사실 → 스티키 방법론 탭·공통 비교조건 → 기관 vs 지역/전국 분석 → 전체 개찰 이력 → 선택 회차의 참여 업체 순서다.
4. MVP 방법론 탭은 **시간별 추이 / 낙찰값 분포** 두 개다. 개찰 이력은 탭이 아니라 두 방법론 아래에 계속 이어지는 표다.
5. 하단은 최근 몇 건만 보여 주는 요약이 아니다. 같은 조건에 해당하는 전체 이력을 서버 페이지 조회로 이어 본다.
   차트 Y축 바깥의 기록도 필터 표본에서 조용히 제외하지 않는다.
6. 기관 vs 기관 비교만으로 바꾸지 않는다. 대상 기관을 강조하고 선택 지역 전체 또는 전국을 비교한다.
7. 모든 차트 전체보기는 **브라우저 콘텐츠 뷰포트 전체**를 채운다. 작은 모달·높이만 조금 확대하는 동작은 불합격이다.
8. 실제 점/이력 행을 선택하면 해당 AuctionAttempt의 참여 업체 명단으로 연결한다.
9. 한 번에 거대한 페이지 DTO와 모든 기능을 만들지 않는다. 컴포넌트별 DTO와 작은 수직 기능 단위로 연결한다.

범위 밖: 업체별 분석 탭, 선택 공고 2–3건 비교, 내 투찰값 overlay, 2등과의 복기 확장, 추천값·예측가·자동 투찰.
앞의 복기 기능들은 후속 후보이고 추천/자동 투찰은 저장소 비목표다. 시안에 버튼이 있다고 구현 범위가 늘어나지 않는다.

## 3. 기존 상세와 새 상세의 관계

사용자가 기존 상세의 레이아웃을 보존할 필요가 없다고 승인했다. 같은 앱 안에서 독립된 조립으로 개발한다.

- 개발·검증 URL: `/auctions/[auctionId]/analysis`.
- 최종 URL: **`/auctions/[auctionId]` 하나**. 준비가 끝나면 새 조립을 기존 URL로 옮기고 임시 route와 기존 상세를 제거한다.
- 기존 상세의 `decision-screen`, `load-auction-page`, 탭/필터 state를 새 페이지의 출발점으로 import하지 않는다.
- 공고·명단 API, 인증/권한, app 사용자 상태, 공통 shell·Toss·전체보기 프레임은 책임에 맞게 재사용한다.
- 철거는 JSX만 지우는 작업이 아니다. Web adapter/query key/cache tag/revalidate → contracts operation → server reader/DI → mart/Argo 소비자를 조사한다.
- Web에서 안 쓴다는 이유만으로 공개 endpoint나 원본/사용자 기록을 없애지 않는다. R2 raw, PostgreSQL core/app은 보존한다.
- 최종 전환과 철거의 work item은 [EAT-224](https://linear.app/eatbid/issue/EAT-224). 기준 계획은
  `docs/superpowers/plans/2026-09-15-detail-cutover.md`다.

## 4. API를 만들기 전에 반드시 할 대조

사용자의 마지막 구현 주의사항은 **기존과 같은 기능의 API가 중복될 수 있으니 유의하라**는 것이다.
경로 이름만 보고 재사용/신설을 결정하지 않는다. 다음 표를 실제 소스와 소비자 검색으로 갱신한다.

| 기존 operation | 현재 의미·소비자 | 다음 작업에서의 판단 |
|---|---|---|
| `findAuction` | 공고 단건. 새 상세 loader가 이미 재사용 | header 때문에 새 endpoint를 만들지 않음 |
| `getAuctionRoster` | 해당 회차의 참여 명단 | EAT-219에서 revision·권한·선택 회차 의미를 확인해 재사용 우선 |
| `listOpenAuctions` | 오늘 목록 | 상세 철거 때문에 같은 auctions resource를 통째로 삭제하지 않음 |
| `listOrganizationAuctionAttempts` | 기존 기관 회차 목록 | 새 공통 관측 집합·임의 날짜/명단 범위·snapshot을 보장하는지 확인 후 확장/대체 |
| `findWinRateDistribution` | 기존 분포 | 동일 cohort와 bin, snapshot을 보장하는지 확인 후 확장/대체 |
| account/own-bid 관련 API | 사용자 상태와 내 투찰 관측 | 기존 상세 전용 provider와 계정 기능을 구분. MVP 밖 UI 철거로 app 상태를 지우지 않음 |

원문은 `packages/contracts/src/api/v1/{auctions,organizations,win-rate-distribution}/operations.ts`,
Web 소비자는 `apps/web/src/api/{auctions,organizations,win-rate-distribution,account}`와
`apps/web/src/app/internal/cache/revalidate/route.ts`에서 추적한다.

슬라이스마다 **method / semantic path / operationId / query·response / 관측 단위 / 필터 / snapshot / 권한 /
cache key·무효화 / 사용처**를 대조해 재사용·수정·신설·폐기를 짧은 표로 남긴다.
같은 책임이면 operation·Web adapter·캐시 소유자를 하나만 둔다. 다른 책임이면 차이를 명시한다.
endpoint 정의는 `packages/contracts` operation만 소유하고 Nest/OpenAPI/Web request는 여기서 파생한다.
페이지 전용 `/api/v1/...` 문자열이나 ENDPOINTS mirror를 만들지 않는다.

## 5. 데이터 의미 — 바꾸면 안 되는 확정 사항

권위 원문은 **PDR-0006**과 **`docs/product/analysis-common-contracts.md`**다. 아래는 놓치기 쉬운 부분의 색인이다.

- 실제 낙찰이 확인되고 낙찰 사정률이 관측된 **AuctionAttempt/revision 하나가 관측 하나**다.
  업체 명단의 행 수만큼 점을 복제하지 않는다. 재입찰은 독립 attempt다.
- 현재 공고 상세의 attempt는 두 집단 모두에서 제외한다. 기관 상세는 exclude가 null이다.
- 날짜는 KST 달력일 양끝 포함, 내부 조회는 정확한 반열림 instant 구간이다. 공고일/개찰일 선택은 X축과 기간에 함께 적용한다.
- 같은 하한율·낙찰방식·명단 최소/최대 조건을 양 집단에 적용한다. 미확인 값을 90%나 대표 코드로 추정하지 않는다.
- 명단 수는 철회 포함 관측 행 수다. 고유 업체 수/유효 경쟁자 수가 아니다. 최소·최대 양끝 포함,
  한쪽 null은 그쪽 제한 없음, `0~0`은 전체와 다르다. 명단 미관측은 범위 활성 시 제외한다.
- 비교지역은 **eaT 공고지역**이다. 행안부 코드나 참가제한지역 코드를 섞지 않는다. 문자열 라벨이 ID가 아니다.
- 지역 조건은 비교군에 적용한다. 기관은 지역 밖이어도 자신의 관측을 유지한다.
- 지역 전체에는 조건을 만족하는 기관 관측도 포함된다. 두 표본을 단순 합산하지 않고 overlapCount를 제공한다.
- 검증된 품목 코드는 기관 쪽에만 적용한다. 비교군은 전체 품목이다. unsupported/unavailable/ready 빈 목록을 구분한다.
- 사정률과 기초금액 대비 투찰률은 다른 값이다. 시안의 90.x 숫자/축 라벨을 검증 없이 생산 의미로 옮기지 않는다.
- 추이·분포·이력은 같은 effectiveFilter와 snapshot의 관측 집합을 사용한다. 점 반환 수/밀도 cell 수/페이지 행 수는 전체 sampleCount가 아니다.
- 분포는 양 집단에 같은 `[from,to)` bin 경계와 전체 밖 건수를 유지한다. MVP는 실제 건수와 집단 내 비중이다.
- 수집 자료 없음/미발행/미지원과 유효한 0건을 구분한다. 표본이 몇 개 있다는 사실은 해당 기간 수집 완전성의 증거가 아니다.
- snapshot은 실제 입력·정책·revision 집합과 martBuildLineage를 검증한 조합이다. 서로 다른 buildId를 같은 숫자로 만들지 않는다.
  한쪽만 준비되거나 조합이 미확인이면 ready를 발급하지 않는다. 만료 시 관련 컴포넌트를 함께 재조회한다.
- DB 발행 반영 목표는 15분이다. 원천 수집 지연과 다르며, build가 오래됐다는 이유만으로 delayed라고 하지 않는다.

앞선 대화의 날짜/명단 범위 유보보다 최종 PDR-0006의 **직접 범위 입력**이 우선한다.
오래된 spec-cohort-v3, PDR-0005의 대체된 부분, 시안의 고정 명단 밴드로 되돌리지 않는다.

## 6. 대량 데이터와 부하의 합의

사용자는 전국 5년 이상에서 월 단위까지 좁혀 보고 싶어 한다. 15만 건은 현재 운영 총량으로 확정한 수치가 아니다.
시안 문서는 2023-09-01~2026-08-31 보유분의 공고 235,075개와 특정 필터의 낙찰 관측 151,648개를 기록한다.
이는 5년 완전 수집 증거나 현재 DB census가 아니며 공고 수와 낙찰점 수도 다르다.

- 넓은 지역/전국 비교는 전체 관측을 집계한 밀도로 전달한다. 기관 점과 좁힌 상세 조회의 반환량도 명시적으로 제한한다.
- 대량 원자료를 전부 browser JSON으로 보내고 투명도만 낮추는 방식으로 해결하지 않는다.
- 분포는 서버 집계, 하단 전체 이력은 서버 페이지 조회다. 임의 표본을 전체 관측 밀도로 표시하지 않는다.
- frontend cache만으로 끝내지 않는다. 서버 공용 캐시·검증된 집계·스냅샷이 필요하다.
  Redis/Cloudflare 제품 선택 자체가 확정된 것은 아니다. EAT-220/221와 실제 운영 경계를 읽고 결정한다.
- 유료 인가는 캐시 hit에서도 유지한다. 개인 기록을 공용 캐시에 섞거나 캐시 키가 권한을 대신하게 하지 않는다.
- 집계·백필·갱신 실행은 Argo Workflows다. 별도 스케줄러/Kubernetes CronJob을 병존시키지 않는다.
- [EAT-222](https://linear.app/eatbid/issue/EAT-222)의 100만 낙찰점·동시 50명은 검증 시나리오다. 이미 측정/통과했다고 쓰지 않는다.
- 밀도 해상도/압축/응답 상한/cache TTL 등의 숫자는 해당 이슈와 측정으로 확정한다. 이 문서는 새로운 고정 수치를 발명하지 않는다.

EAT-216 등록 문서의 5천 실제 점/2만 밀도 칸은 초기 측정 가설이다. 반드시 응답 bytes와 브라우저 비용을 측정하며,
화면 pixel 좌표 대신 의미 있는 해상도 구간을 요청한다. 밀도 칸은 실제 공고처럼 선택하지 않고 범위를 좁힌다.
기관 관측이 많아져도 임의 절단하지 않고 조회 범위를 좁히는 명시적 상태를 제공한다.

## 7. 현재 코드의 연결 지점과 미완료

`apps/web/src/app/(workspace)/auctions/[auctionId]/analysis/`가 새 상세의 임시 소유 경로다.

| 경로 | 지금 하는 일 | 이어서 할 때 주의 |
|---|---|---|
| `page.tsx`, `_lib/load-analysis-page.ts` | 공고 단건 + 주입 Clock으로 header/setup/applied 조립 | 기존 상세 이력/분포 loader를 불러오지 않음 |
| `_lib/analysis-search.ts` | URL의 `analysis`, `view=time|distribution`, `full` | 공통 필터 원자 적용. 탭/확대만 바뀔 때 조건 유지 |
| `_features/analysis-filters/model/*` | 입력 초안·달력/범위 검증·기본 조건 | 폼 문자열과 의미 DTO를 분리 |
| `_features/analysis-filters/ui/*` | 조건 입력, 적용, 오류, stale 응답 gate | URL과 다른 요청의 결과를 보이지 않는 성질 유지 |
| `_features/analysis-view/ui/analysis-workspace.tsx` | 두 탭, 키보드, 전체보기·Escape·초점/스크롤 복귀 | 전체보기 때문에 별도 분석 API를 만들지 않음 |
| `_widgets/analysis-frame.tsx`와 skeleton/CSS | 일반/로딩의 공통 틀 | Toss/shared ApplicationShell/ChartFullscreenFrame 재사용 |
| `_widgets/analysis-evidence.tsx` 등 | 분석·표 자리의 준비 상태 | 실제 chart/density/bin/history row가 아직 없음 |
| `packages/contracts/src/api/v1/analysis/*` | 공통 filter/options/meta/snapshot resource | **분석 조회 operation은 아직 없음**. 완성된 페이지 DTO가 아님 |
| `packages/contracts/src/codecs/analysis.ts` | 서버 의미 검증 | browser-safe portable graph에 Temporal/codec를 섞지 않음 |
| `packages/domain/src/analysis/*` | 달력 기간·cohort bounds·freshness 의미 | 숫자/시간 경계를 원시값으로 우회하지 않음 |

EAT-215는 공고에서 관측된 지역/하한율/낙찰방식만 선택지로 seed한다. 활성 코드 사전의 존재를 보장하지 않는다.
실제 보유 날짜를 모르므로 전 기간은 비활성, 기관 품목은 공급 전이라 전체 품목만 제공한다.
12/6/3/2/1 프리셋은 오늘 KST까지 해당 달력월 수의 첫 달 1일부터다.
실제 공고 89는 기관 ID가 있어도 기관 이름·지역/방식 라벨이 미확인으로 표시됐다.
표제 문자열에서 추출해 이름을 꾸며 넣지 말고 공급 계약/코드 사전 연결을 확인한다.

## 8. 다음 슬라이스와 첫 행동

부모는 [EAT-176](https://linear.app/eatbid/issue/EAT-176)이다. 아래 표는 책임 색인이며 현재 state/owner는 다시 읽는다.
외부 전달 묶음의 `reference/linear/EAT-198.md`, `EAT-216.md`~`EAT-223.md`는 이전 등록에 쓴 참고 사본이다.
필수 의존 파일은 아니며 최신 Linear 본문/owner/state를 읽는 것이 우선이다.

| 이슈 | 책임 |
|---|---|
| EAT-213 | 공통 필터·표본·스냅샷 DTO. 병합된 기반 |
| EAT-214 | 모든 차트의 전체 뷰포트 프레임. 기존 기반 |
| EAT-215 | 공고 정보·스티키 공통 조건·새 상세 틀. PR #26 병합 확인 |
| EAT-198 | 임의 날짜·명단 범위를 정확히 지원하는 공통 분석 관측/집계 |
| EAT-216 | 기관 실제 점 + 지역/전국 전체 관측 밀도의 시간축 비교 |
| EAT-217 | 동일 bin의 기관/비교군 분포 건수·비중 |
| EAT-218 | 같은 관측 집합의 전체 개찰 이력 페이지 조회 |
| EAT-219 | 선택 회차 참여 업체. 기존 roster API 의미 대조 |
| EAT-220 | 검증된 입력 조합과 DB 발행 후 15분 목표의 스냅샷 교체 |
| EAT-221 | 유료 인가를 보존하는 서버 공용 캐시 |
| EAT-222 | 수치 정합성과 100만 점·동시 50명 부하 검증 |
| EAT-224 | 최종 URL 교체 + 임시/기존 UI 및 사용 중지 API 사슬 철거 |
| EAT-223 | 기관 자체 진입 재사용 후속 후보. 공고 상세 MVP에 무조건 포함하지 않음 |

새 Claude의 첫 순서:

1. 아래 필수 원문을 읽고 `git worktree list`, 해당 worktree status/log, workflow doctor로 실제 상태를 확인한다.
2. 기존 writer와 자식 시험이 살아 있는지 확인한다. 잠금 파일 수기 편집/일괄 프로세스 종료/강제 reset으로 정리하지 않는다.
3. `git fetch origin` 후 PR #26 병합과 최신 origin/main 포함 여부를 확인한다. 오래된 root main에서 분기하지 않는다.
4. Linear EAT-176/198/216/220/224의 최신 본문·handoff·owner를 읽는다. 인증이 없다면 준비 읽기를 계속하고 claim 전 쓰기는 멈춘다.
5. **첫 기술 결과는 EAT-198/216 공급 경계 조사**다. 기존 기관/분포 reader가 같은 관측 집합을 보장하는지 대조표를 남긴다.
   공통 입력이 미완료면 그 선행 슬라이스를 먼저 구현한다. 이미 완료됐으면 중복 작업 없이 EAT-216의 실제 자료 연결로 간다.
6. 다음 한 issue에 assign/claim하고 그 worktree에서 doctor를 통과한 뒤 owned paths·기준 commit·인수 조건을 Linear에 기록한다.
   이번 인계는 특정 미완료 issue의 쓰기를 미리 claim하지 않는다.
7. 한 컴포넌트에 필요한 DTO → 기존 operation 재사용/수정 판단 → 서버/클라이언트 연결 → dev 시안 비교 → 관련 검사로 진행한다.
8. 사용자에게 같은 기획의 재승인을 요구하지 않는다. 새로운 제품 의미만 영향과 함께 질문한다.

EAT-215는 PR/CI 근거로 Done 갱신했다. 부모 EAT-176이나 EAT-224를 함께 Done 처리하지 않는다.
운영 배포·production 데이터 변경은 이 인계만으로 새로 승인된 것이 아니다. 이전 Codex 허가를 기다릴 필요는 없다.

## 9. 시안과 구현을 보는 방법

시안 버전은 **`g-methods/?revision=region-comparison-2`**다. 과거 E 통합안이나 기존 앱 화면을 최신 시안으로 대체하지 않는다.
원본 로컬 폴더:

`C:/Users/kano/.codex/visualizations/2026/09/13/01a09b40-5945-72f3-8342-9f852ffa1193/detail-exploration/g-methods/`

`index.html`, `style.css`, `design-scope.md`, `10-institution-region.jpg`를 읽는다.
HTML은 이웃 `e-integrated`의 theme/style/snapshot/roster 데이터에 의존한다. g-methods 폴더 하나만 서버로 열면 동일하게 동작하지 않는다.
8769는 현재 내려가 있으므로 살아 있다고 가정하지 않는다. 시안용 HTTP 서버는 필요한 원본 상위 폴더에서 loopback으로 열고,
생산 앱 dev와 구분한다. 이 묶음은 대량 raw/명단 데이터 전체를 복제하지 않았다.

저장소에 보존한 시각 자료([출처와 해시](2026-09-15-detail-mvp-assets/README.md)):

- [기관 vs 지역 시안](2026-09-15-detail-mvp-assets/design-region-comparison-2.jpg): 최신 기관 vs 지역 시안. 스크롤된 화면이며 현재 공고 header의 캡처가 아님.
- [분포 보조 시안](2026-09-15-detail-mvp-assets/design-distribution-earlier.jpg): region-comparison-2 전 캡처이므로 문구/숫자/필터는 최신 기준이 아님.
- [구현 일반보기](2026-09-15-detail-mvp-assets/implementation-fixture-desktop.png), [전체보기](2026-09-15-detail-mvp-assets/implementation-fixture-fullscreen.png), [모바일](2026-09-15-detail-mvp-assets/implementation-fixture-mobile.png):
  PR #26의 Playwright fixture 화면. **실제 운영 자료 연결 증거가 아님**.

같은 fixture·viewport·테마·필터·패널 상태로 시안과 구현을 비교하고, 실제 API 자료의 정합성 검증은 별도로 한다.
Toss 지면·위계·스티키 조건·큰 그래프·아래 연속 이력을 맞춘다. 시안의 가상 수치/잘못된 단위/확장 탭을 생산 계약에 복사하지 않는다.
서로 다른 기관·표본의 두 캡처를 픽셀 일치 증거로 쓰지 않는다. 실제 dev 캡처를 새 작업의 인계에 남긴다.

## 10. dev와 검증

로그인 원문은 `docs/operations/local-dev-login.md`, 비밀 주입은 `docs/operations/infisical.md`다.
3215/4400/8769는 이번 확인 시 모두 listener가 없었다. 필요한 프로세스는 소유 worktree와 환경을 확인해 다시 시작한다.
root/다른 작업의 dev·수집 프로세스를 종료하거나 production 연결값을 사용하지 않는다.

server는 문서의 비밀 주입과 개발 DB 준비 후 `pnpm --filter @eatbid/server dev`로 시작한다.
3215를 쓰면 서버의 `BETTER_AUTH_URL`/`CORS_ORIGINS`도 해당 Web origin과 맞아야 한다.
Web은 준비된 같은 worktree에서 다음 비밀이 아닌 환경으로 실행할 수 있다.

```powershell
$env:API_URL = 'http://localhost:4400'
$env:EATBID_DEV_LOGIN = 'true'
$env:NEXT_PUBLIC_SENTRY_DISABLED = 'true'
pnpm --filter @eatbid/web dev --hostname localhost --port 3215
```

개발 계정은 로그인 문서의 합성 계정을 사용한다. 운영 인증 gate를 우회하지 않는다.
접속은 `http://localhost:3215/auctions/89/analysis`. 기관명이 미확인이어도 임의 값으로 바꾸지 않는다.
build와 dev가 같은 `.next`를 동시에 쓰지 않게 작업을 직렬화한다. 새 worktree는 frozen install·필요 package build부터 확인한다.

마지막 구현의 검증 근거:

- 새 단위 13건과 domain 분석 3건 통과 기록.
- `apps/web/e2e/analysis-filters.spec.ts` 브라우저 3건: 초안/적용/오류·키보드탭·URL 유지·전체보기·모바일·잘못된 조건.
- 1440×900과 375×812에서 전체보기 좌표 x/y=0과 viewport 전체 너비·높이 검증.
- Web typecheck, production build, architecture 18개(contracts JSON/Python check 포함) 통과 기록.
- Web lint 오류 0, 변경 밖 기존 경고 7개. 경고가 없다고 표현하지 않는다.
- `pnpm review:ai -- --base origin/main` advisory는 c47c31fe 기준 finding 없음 기록.
- PR #26 required CI `아키텍처·테스트·빌드 검증`, `프론트엔드 browser 기반 검증` 모두 SUCCESS를 이번에도 조회 확인.
- 실제 dev 공고 89의 진입·Toss·미확인 표시 확인 기록. 실제 추이/분포/표 데이터 연결·부하·시안 픽셀 충실도는 미검증.

후속 변경 후에는 해당 단위와 browser 테스트, typecheck/lint 및 변경에 맞는 gate를 다시 수행한다.
계약 변경은 `pnpm architecture:check`, `pnpm contracts:check`, `pnpm contracts:python:check`를 check mode로 실행한다.
공통 browser fixture는 `apps/web/playwright.config.ts`와 `apps/web/e2e/support/auction-contract-fixture-server.ts`다.
`pnpm --filter @eatbid/web exec playwright test analysis-filters.spec.ts`는 그 설정의 별도 테스트 서버를 띄운다.
`pnpm review:ai`는 결정적 검사 뒤 읽기 전용 advisory다. 완료 후 issue worktree에서 `pnpm workflow:pr`, main 직접 push 금지.

## 11. 필수 원문 — 제목만 읽고 넘기지 말 것

아래 경로는 **새 writer가 선택한 최신 worktree 기준**이다. 상대 경로 원문을 실제로 읽는다.
동봉 `reference/repository/`는 c47c31fe의 편의 스냅샷이며 최신 clone의 원문을 대체하지 않는다.

1. `AGENTS.md`
2. `ARCHITECTURE.md`
3. `docs/architecture/README.md`
4. `docs/architecture/product-and-quality.md`
5. `docs/architecture/domain-and-data.md`
6. `docs/architecture/c4.md`
7. `docs/architecture/runtime-and-deployment.md`
8. `docs/architecture/arc42.md`
9. `docs/adr/README.md`
10. `docs/architecture/time-and-value-contracts.md`
11. `docs/operations/agent-resume.md`
12. `docs/operations/linear-agent-workflow.md`
13. `docs/governance/ai-driven-documentation.md` 7절과 `.agents/skills/eatbid-supervised-delivery/SKILL.md`
14. `apps/web/AGENTS.md`
15. `docs/product/decisions/0006-institution-and-regional-analysis.md`
16. `docs/product/analysis-common-contracts.md`
17. `docs/superpowers/plans/2026-09-15-detail-filters.md`
18. `docs/superpowers/plans/2026-09-15-detail-cutover.md`
19. `docs/operations/local-dev-login.md`, `docs/operations/infisical.md`
20. 변경 경계에 맞는 `.agents/skills/eatbid-{component-design,contract-change,vertical-slice,web-accessibility,dataplane-invariants}/SKILL.md`

특히 SSOT(raw/core/app/mart), 숫자 ID·지역 CodeScheme, 의미 단위·Temporal/Clock, portable Zod composition,
operation 단일 소유권, 한국어 모듈 책임/이유 주석/테스트명, 300줄 책임 분리 검토를 지킨다.

## 12. 다음 교대에도 남길 것

Linear에는 issue·branch/worktree·기준 commit·owned paths·다음 한 단계·검증/미검증·blocker를 남긴다.
작업 계획과 API 대조표는 코드와 같은 Git 변경으로 남긴다. 비밀값·세션 토큰·원문 대화 로그는 복사하지 않는다.
새 Claude는 이 문서를 읽은 뒤 발견한 실제 차이만 갱신하며 과거 백로그 상태를 현행으로 복원하지 않는다.

인증 회복과 EAT-225 claim, EAT-215 Done 갱신은 완료했다. 문서 반영의 PR/CI/최종 상태는 EAT-225 최신 인계에서
확인한다. 이후 첫 기술 작업은 8절의 EAT-198/216 공급 경계 조사다. MCP가 연결돼 있으면 조회/수정은 그것을 우선 사용한다.
인증이 다시 만료돼도 credentials를 추출하거나 gate를 끄지 않는다. 키를 사용자에게 채팅으로 보내 달라고 하지 않는다.

전달용 캡처·오프라인 참고 사본의 로컬 위치: `C:/Users/kano/.codex/visualizations/2026/09/13/01a09b40-5945-72f3-8342-9f852ffa1193/detail-exploration/claude-handoff`
