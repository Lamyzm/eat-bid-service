/** @module 책임: 결정 화면과 skeleton이 공유하는 2열 geometry와 section 순서를 제공한다. */
type DecisionFrameProps = {
  readonly header: React.ReactNode;
  readonly banner: React.ReactNode;
  readonly evidence: React.ReactNode;
  readonly rail: React.ReactNode;
  readonly history: React.ReactNode;
};

// 1280 이상은 근거 열 + rail 340. 그 아래는 한 열로 쌓고 rail이 근거 위에 온다(투찰이 1차 행동).
export function DecisionFrame({ header, banner, evidence, rail, history }: DecisionFrameProps) {
  return (
    <div data-slot='decision-screen' aria-labelledby='decision-title' className='mx-auto grid w-full max-w-[1400px] min-w-0 gap-4 px-3 py-3 sm:px-4'>
      <header className='min-w-0'>{header}</header>
      <section aria-label='공고 상태' className='min-w-0'>{banner}</section>
      <div className='grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start'>
        <div className='order-2 grid min-w-0 gap-4 lg:order-1'>
          <section aria-label='근거' className='min-w-0'>{evidence}</section>
          <section aria-label='과거 회차' className='min-w-0'>{history}</section>
        </div>
        <aside aria-label='투찰' className='order-1 min-w-0 lg:order-2'>{rail}</aside>
      </div>
    </div>
  );
}
