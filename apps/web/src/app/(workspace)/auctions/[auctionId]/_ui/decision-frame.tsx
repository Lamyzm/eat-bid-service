/** @module 책임: 전역 보조 공간과 독립된 분석 본문의 전체 폭과 실제 화면·skeleton의 section 순서를 제공한다. */
type DecisionFrameProps = {
  readonly header: React.ReactNode;
  readonly banner: React.ReactNode;
  readonly filters: React.ReactNode;
  readonly evidence: React.ReactNode;
  readonly history: React.ReactNode;
  readonly focus?: boolean;
};

// 상세와 도구는 공통 레이아웃이 배치한다. 프레임은 차트·표를 다시 마운트하지 않고 주어진 폭을 쓴다.
export function DecisionFrame({
  header,
  banner,
  filters,
  evidence,
  history,
  focus = false
}: DecisionFrameProps) {
  return (
    <div
      data-slot='decision-screen'
      data-focus={focus || undefined}
      role='region'
      aria-labelledby='decision-title'
      className='grid w-full min-w-0 gap-4 py-3'
    >
      <header className='min-w-0'>{header}</header>
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
      </div>
    </div>
  );
}
