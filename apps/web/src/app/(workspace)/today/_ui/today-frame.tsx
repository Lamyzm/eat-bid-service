/** @module 책임: 오늘 화면과 skeleton이 공유하는 한 열 geometry와 section 순서를 제공한다. 오른쪽 rail은 두지 않는다. */
type TodayFrameProps = {
  readonly header: React.ReactNode;
  readonly filters: React.ReactNode;
  readonly list: React.ReactNode;
};

export function TodayFrame({ header, filters, list }: TodayFrameProps) {
  return (
    <div data-slot='today-screen' role='region' aria-labelledby='today-title' className='mx-auto grid w-full max-w-[1400px] min-w-0 gap-4 px-3 py-3 sm:px-4'>
      <header className='min-w-0'>{header}</header>
      <section aria-label='조건' className='min-w-0'>{filters}</section>
      <section aria-label='열린 공고' className='min-w-0'>{list}</section>
    </div>
  );
}
