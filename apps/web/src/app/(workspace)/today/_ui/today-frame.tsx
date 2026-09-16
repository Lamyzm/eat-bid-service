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
 */
export function TodayFrame({ header, rail, filters, list }: TodayFrameProps) {
  return (
    <div data-slot='today-screen' role='region' aria-labelledby='today-title' className='grid w-full min-w-0 xl:grid-cols-[252px_minmax(0,1fr)]'>
      <aside aria-label='내 조건' className='min-w-0 border-b border-border px-4 py-5 xl:border-r xl:border-b-0 xl:py-6'>
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
