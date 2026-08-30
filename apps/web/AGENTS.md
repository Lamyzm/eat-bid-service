# eatbid web 작업 계약

루트 [`AGENTS.md`](../../AGENTS.md)의 모든 규칙이 이 디렉터리에도 적용된다. 이 파일은
`apps/web`에서만 필요한 현재 구현 제약을 추가하며 별도 제품 정의를 만들지 않는다.

## 제품 경계

- 이 앱은 범용 admin starter가 아니라 eatbid 운영 워크스페이스다. 화면 의미와 우선순위는
  [`docs/product/roadmap.md`](../../docs/product/roadmap.md)에서 읽는다.
- 관측 사실, 분석 파생값, 사용자 작성 상태를 같은 라벨이나 필드로 합치지 않는다.
- 분석에는 표본 수, 기간/cohort, `as_of`, 계산 버전, 산출 시각과 원본 provenance를 함께
  표현한다. `unknown`, stale, 부분 수집을 정상값처럼 숨기지 않는다.
- 추천 투찰가·예정가 예측·자동 NeaT 입력으로 해석될 기본값이나 행동 유도 문구를 만들지 않는다.

## 현재 기술 계약

- Next.js `16.2.12`, React `19.2.4`, TypeScript `5.7.2`, Tailwind CSS 4를 사용한다.
- 모노레포 package manager는 루트 `package.json`에 고정된 `pnpm 10.12.1`이다. 앱 내부
  script가 Bun 명령을 호출하더라도 workspace 설치·실행 계약을 Bun으로 바꾸지 않는다.
- Server Component를 기본으로 하고 브라우저 상태나 상호작용이 필요할 때만 `'use client'`를
  사용한다.
- TanStack Query provider와 query client는 존재하지만 제품 feature의 data-access 구조는 아직
  canonical pattern으로 검증되지 않았다. 첫 실제 API vertical slice에서 contract와 폴더 경계를
  검증하기 전 `api/types.ts → api/service.ts → api/queries.ts`를 현행처럼 발명하지 않는다.
- 제품 데이터는 NestJS API 계약을 통해 읽는다. 새 화면을 mock store나 Next Route Handler의
  별도 업무 진실 원천에 연결하지 않는다.
- URL 검색 상태는 기존 `nuqs` parser를 재사용한다.
- 아이콘은 `@/components/icons`에서만 가져온다.
- 내부 bigint ID는 HTTP 경계에서 선행 0 없는 양의 10진 문자열이다. JavaScript `Number`로
  변환하지 않는다. 상세 계약은 ADR 0018을 따른다.

## 화면과 코드

- 한 화면의 1차 질문과 주 행동은 하나로 유지한다.
- 확정 사실을 먼저, 직접 비교를 다음에, 원자료·산식·revision을 상세 단계에 둔다.
- 상태는 색만으로 전달하지 않고 텍스트를 함께 제공한다.
- 화면 문구를 enum이나 계산 로직으로 다시 읽지 않는다.
- formatting은 single quote, JSX single quote, no trailing comma, 2-space indent를 따른다.

## 검증 명령

변경 범위에 맞는 최소 명령을 루트에서 실행한다.

```text
pnpm --filter @eatbid/web typecheck
pnpm --filter @eatbid/web lint
pnpm --filter @eatbid/web build
```

빌드가 필요하지 않은 문서·문구 변경에 전체 build를 의례적으로 강제하지 않는다. 실행한 명령과
실행하지 못한 검증은 PR evidence에 정확히 남긴다.
