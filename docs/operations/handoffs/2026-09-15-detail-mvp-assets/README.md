---
id: OPS-DETAIL-MVP-HANDOFF-VISUALS-20260915
status: evidence
canonical_for: detail-mvp-handoff-visual-evidence-20260915
last_reviewed: 2026-09-15
review_trigger: approved-detail-design-or-implementation-evidence-change
---

# 상세 인계 시각 자료

[인계 본문](../2026-09-15-detail-mvp.md)의 시안과 구현을 이전 브라우저 세션 없이 볼 수 있게 보존했다.
디자인은 `g-methods/?revision=region-comparison-2`, 생산 의미는 PDR-0006과 공통 분석 계약을 따른다.
이미지의 예시 수치·단위·후속 탭을 생산 계약의 확정값으로 복사하지 않는다.

| 파일 | 출처와 의미 |
|---|---|
| [기관 vs 지역](design-region-comparison-2.jpg) | G 시안 `10-institution-region.jpg`. 스크롤된 비교 화면이며 공고 header가 보이지 않음 |
| [분포 참고](design-distribution-earlier.jpg) | G 시안 `03-distribution.jpg`. 지역 비교 개정 전 보조 이미지로 문구/숫자는 최신 기준이 아님 |
| [구현 일반](implementation-fixture-desktop.png) | EAT-215 Playwright `새-상세-1440.png`. fixture 기반이며 실제 분석 자료 미연결 |
| [구현 전체보기](implementation-fixture-fullscreen.png) | 같은 테스트 `새-상세-전체보기.png`, 1440×900 전체 뷰포트 |
| [구현 모바일](implementation-fixture-mobile.png) | 같은 테스트 `새-상세-375.png`, 375×812에서 촬영한 full-page 캡처 |

원본 G 폴더는 인계 본문 9절의 로컬 경로에 있다. 구현 캡처 원본은 commit `c47c31fe`를 검증한
`apps/web/e2e/analysis-filters.spec.ts`의 `apps/web/test-results/foundation/` 산출물이다.
서로 다른 fixture·기관·표본을 쓰므로 이 이미지들을 픽셀 일치 또는 실제 데이터 연결의 증거로 쓰지 않는다.

캡처 내용은 재편집하지 않고 복사했으며 원본 SHA-256은 옆의 [파일 목록](manifest.json)에 남겼다.
