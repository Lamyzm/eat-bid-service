/** @module 책임: 오늘 화면과 skeleton이 공유하는 두 열 geometry(셸에 붙은 왼쪽 조건 기둥·본문)와 section 순서를 제공한다. 오른쪽 rail은 두지 않는다. */
type TodayFrameProps = {
  readonly header: React.ReactNode;
  readonly rail: React.ReactNode;
  readonly filters: React.ReactNode;
  readonly list: React.ReactNode;
};

/**
 * 기둥은 셸 탐색 바로 옆에 **붙어** 선다(U9, 사용자 결정 2026-09-17). 본문 카드 안에 띄워 두면 기둥·본문·셸 세
 * 면이 각자 여백을 갖고 화면이 세 조각으로 갈라진다. 기둥은 252px에 오른쪽 선 하나, 본문은 1040px까지이고
 * 가운데 정렬하지 않는다 — 넓은 화면에서 목록이 오른쪽으로 떠 있으면 기둥과 목록 사이가 벌어진다.
 *
 * 기둥은 xl(1280)부터 옆에 서고 그 아래에서 본문 위로 내려온다. 표였을 때는 xl에서 본문이 708px뿐이라 여덟 칸이
 * 접혀 2xl부터였지만(2026-09-16 실측), 카드 행은 그 폭에서 세 줄이 그대로 서므로 한 단계 아래로 내렸다(EAT-260).
 *
 * 옆에 서는 폭에서 기둥은 **화면에 붙어 자기 스크롤을 갖는다**(사용자 요청 2026-09-17). 목록은 200행까지 서므로
 * 같이 흘러가면 조건을 바꾸려고 맨 위까지 되돌아와야 하는데, 조건은 "이 화면의 모든 수가 어떤 집합을 세는가"의
 * 선언이라 수를 보는 동안 함께 보여야 한다(§6.4.1). 셸 머리가 이미 위에 붙어 있으므로 그 높이만큼 내려 앉으며,
 * 같은 변수를 셸의 도구 줄도 쓴다(`workspace-layout.css`). `overscroll-contain`은 기둥 끝에서 본문이 딸려
 * 스크롤되는 것을 막는다. 눕는 폭에서는 붙이지 않는다 — 좁은 화면에서 세로를 나눠 쓰면 둘 다 못 읽는다.
 */
export function TodayFrame({ header, rail, filters, list }: TodayFrameProps) {
  return (
    <div data-slot='today-screen' role='region' aria-labelledby='today-title' className='grid w-full min-w-0 xl:grid-cols-[252px_minmax(0,1fr)] xl:items-start'>
      <aside
        aria-label='내 조건'
        className='min-w-0 border-b border-border px-4 py-5 xl:sticky xl:top-[var(--workspace-header-height,0px)] xl:h-[calc(100dvh-var(--workspace-header-height,0px))] xl:overflow-y-auto xl:overscroll-contain xl:border-r xl:border-b-0 xl:py-6'
      >
        {rail}
      </aside>
      <div className='min-w-0 max-w-[1112px] px-4 py-5 sm:px-6 xl:px-9 xl:py-7'>
        <header className='min-w-0'>{header}</header>
        <div className='grid min-w-0 content-start gap-3 pt-5'>
          <section aria-label='조건' className='min-w-0'>{filters}</section>
          <section aria-label='열린 공고' className='min-w-0'>{list}</section>
        </div>
      </div>
    </div>
  );
}
