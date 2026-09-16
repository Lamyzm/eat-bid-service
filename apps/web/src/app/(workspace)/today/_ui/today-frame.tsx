/** @module 책임: 오늘 화면과 skeleton이 공유하는 두 열 geometry(왼쪽 조건 기둥·본문)와 section 순서를 제공한다. 오른쪽 rail은 두지 않는다. */
type TodayFrameProps = {
  readonly header: React.ReactNode;
  readonly rail: React.ReactNode;
  readonly filters: React.ReactNode;
  readonly list: React.ReactNode;
};

/**
 * 본문 폭을 재는 것은 화면 폭이 아니라 표다.
 *
 * 표가 여섯 칸 15px일 때는 780이 맞았다 — 그보다 넓히면 칸 사이가 손가락 두 개만큼 벌어져 한 행을
 * 읽는 데 눈이 가로로 두 번 움직였다. 지금은 여덟 칸 13px 한 줄이라 반대로 780에서는 기관 칸이 160px로
 * 눌려 이름이 잘린다. 1040은 토스증권 목록(열 칸 1,142px)과 같은 칸당 폭이고, 행이 44px로 얇아
 * 세로 흐름은 그대로 남는다(2026-09-16 실측). 넓어진 폭은 기관 칸 하나가 가져간다.
 *
 * 기둥은 2xl(1536) 아래에서 본문 위로 내려온다. xl(1280)에서 옆에 두면 셸 탐색과 기둥을 뺀 표가 708px뿐이라
 * 여덟 칸의 고정 열 합(708px)에 기관 칸이 0으로 무너지고, 지난번·보통을 접어 여섯 칸으로 만들면 우리만 가진
 * 두 값이 가장 흔한 노트북 폭에서 둘째 줄로 내려간다(2026-09-16 실측). 기둥이 위로 가면 xl에서 표가 976px을
 * 받아 여덟 칸이 한 줄로 선다.
 */
export function TodayFrame({ header, rail, filters, list }: TodayFrameProps) {
  return (
    <div data-slot='today-screen' role='region' aria-labelledby='today-title' className='mx-auto grid w-full max-w-[1288px] min-w-0 gap-4 px-3 py-3 sm:px-4'>
      <header className='min-w-0'>{header}</header>
      <div className='grid min-w-0 gap-x-6 gap-y-4 2xl:grid-cols-[220px_minmax(0,1040px)]'>
        <aside aria-label='내 조건' className='min-w-0'>{rail}</aside>
        {/* 표면은 하나다. 조건과 목록을 각각 카드에 담으면 테두리가 되풀이되면서 둘이 다른 화면처럼
            갈라지고, 조건을 바꿀 때 눈이 두 면을 오간다(screen-system §9.1). */}
        <div className='grid min-w-0 gap-3 rounded-xl bg-card p-4 shadow-xs'>
          <section aria-label='조건' className='min-w-0'>{filters}</section>
          <section aria-label='열린 공고' className='min-w-0'>{list}</section>
        </div>
      </div>
    </div>
  );
}
