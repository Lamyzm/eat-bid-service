/** @module 책임: 전역 보조 공간과 독립된 분석 본문의 전체 폭, 실제 화면·skeleton의 section 순서, 어느 본문이 집중 모드인지를 제공한다. */

/** 집중 모드로 키울 본문. 흐름 차트와 과거 회차 표는 같은 geometry를 쓰고 값만 다르다(EAT-115). */
export type DecisionFocus = 'flow' | 'history';

type DecisionFrameProps = {
  readonly header: React.ReactNode;
  readonly filters: React.ReactNode;
  readonly evidence: React.ReactNode;
  readonly history: React.ReactNode;
  readonly focus?: DecisionFocus;
};

// 상세와 도구는 공통 레이아웃이 배치한다. 프레임은 차트·표를 다시 마운트하지 않고 주어진 폭을 쓴다.
export function DecisionFrame({ header, filters, evidence, history, focus }: DecisionFrameProps) {
  return (
    <div
      data-slot='decision-screen'
      data-focus={focus}
      role='region'
      aria-labelledby='decision-title'
      className='grid w-full min-w-0 gap-4 py-3'
    >
      <header className='min-w-0'>{header}</header>
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
