/** @module 책임: 결정 화면과 skeleton이 공유하는 2열 geometry와 section 순서를 제공한다. */
type DecisionFrameProps = {
  readonly header: React.ReactNode;
  readonly banner: React.ReactNode;
  readonly filters: React.ReactNode;
  readonly evidence: React.ReactNode;
  readonly rail: React.ReactNode;
  readonly history: React.ReactNode;
  readonly focus?: boolean;
};

// 1280 이상(xl)은 근거 열 + rail 340. 그 아래는 한 열로 쌓고 rail이 근거 위에 온다(투찰이 1차 행동).
// lg(1024)에서 두 열로 가르면 사이드바 256을 뺀 근거 열이 약 430px라 8열 표와 흐름 차트가 가로로 넘친다.
export function DecisionFrame({ header, banner, filters, evidence, rail, history, focus = false }: DecisionFrameProps) {
  return (
    <div
      data-slot='decision-screen'
      data-focus={focus || undefined}
      role='region'
      aria-labelledby='decision-title'
      className='mx-auto grid w-full max-w-[1600px] min-w-0 gap-4 px-3 py-3 sm:px-4'
    >
      <header className='min-w-0'>{header}</header>
      <section aria-label='공고 상태' className='min-w-0'>
        {banner}
      </section>
      <div data-slot='decision-filter-bar' className='min-w-0'>
        {filters}
      </div>
      <div data-slot='decision-columns' className='grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start'>
        <div data-slot='decision-main' className='order-2 grid min-w-0 gap-4 xl:order-1'>
          <section aria-label='근거' className='min-w-0'>
            {evidence}
          </section>
          <section aria-label='과거 회차' className='min-w-0'>
            {history}
          </section>
        </div>
        <aside
          aria-label='공고 보조 정보'
          className='order-1 min-w-0 xl:sticky xl:top-20 xl:order-2'
        >
          {rail}
        </aside>
      </div>
    </div>
  );
}
