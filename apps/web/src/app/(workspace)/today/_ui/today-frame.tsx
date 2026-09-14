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
 * 한 열로 두면 1440에서 본문이 1,080px이 되고 여섯 칸이 그만큼 벌어진다. 기관 이름과 기초금액 사이가
 * 손가락 두 개만큼 떨어지면 한 행을 읽는 데 눈이 가로로 두 번 움직인다. 왼쪽에 조건 기둥을 두어 폭을
 * 780으로 묶으면 여섯 칸이 한눈에 들어오고, 좁힌 조건이 목록 옆에 계속 남는다.
 *
 * 기둥은 lg 아래에서 본문 위로 내려온다. 좁은 화면에서 220px을 떼면 표가 읽을 수 없게 된다.
 */
export function TodayFrame({ header, rail, filters, list }: TodayFrameProps) {
  return (
    <div data-slot='today-screen' role='region' aria-labelledby='today-title' className='mx-auto grid w-full max-w-[1024px] min-w-0 gap-4 px-3 py-3 sm:px-4'>
      <header className='min-w-0'>{header}</header>
      <div className='grid min-w-0 gap-x-6 gap-y-4 lg:grid-cols-[220px_minmax(0,780px)]'>
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
