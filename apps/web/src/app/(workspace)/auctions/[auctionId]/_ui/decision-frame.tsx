/** @module 책임: 결정 화면과 skeleton이 공유하는 2열 geometry와 section 순서를 제공한다. */
type DecisionFrameProps = {
  readonly header: React.ReactNode;
  readonly toolbar?: React.ReactNode;
  readonly banner: React.ReactNode;
  readonly filters: React.ReactNode;
  readonly evidence: React.ReactNode;
  readonly rail: React.ReactNode;
  readonly history: React.ReactNode;
  readonly focus?: boolean;
};

// 보조 내용의 열림과 무관하게 근거·표의 DOM을 유지한다. 1200px 미만의 상세는 공유 Sheet로
// 열리며, 프레임의 오른쪽 열은 공간을 차지하지 않는다. skeleton도 같은 지면을 사용한다.
export function DecisionFrame({
  header,
  toolbar,
  banner,
  filters,
  evidence,
  rail,
  history,
  focus = false
}: DecisionFrameProps) {
  return (
    <div
      data-slot='decision-screen'
      data-focus={focus || undefined}
      role='region'
      aria-labelledby='decision-title'
      className='mx-auto grid w-full max-w-[1600px] min-w-0 gap-4 px-3 py-3 sm:px-4'
    >
      <header className='min-w-0'>{header}</header>
      {toolbar}
      <section aria-label='공고 상태' className='min-w-0'>
        {banner}
      </section>
      <div data-slot='decision-filter-bar' className='min-w-0'>
        {filters}
      </div>
      <div data-slot='decision-columns' className='grid min-w-0 gap-4'>
        <div data-slot='decision-main' className='grid min-w-0 gap-4'>
          <section aria-label='근거' className='min-w-0'>
            {evidence}
          </section>
          <section aria-label='과거 회차' className='min-w-0'>
            {history}
          </section>
        </div>
        <aside aria-label='공고 보조 정보' className='min-w-0'>
          {rail}
        </aside>
      </div>
    </div>
  );
}
