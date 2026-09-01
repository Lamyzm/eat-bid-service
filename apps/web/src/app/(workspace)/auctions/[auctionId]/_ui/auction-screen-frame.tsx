type AuctionScreenFrameProps = {
  readonly header: React.ReactNode;
  readonly summary: React.ReactNode;
  readonly details: React.ReactNode;
};

/** 실제 화면과 route fallback이 동일한 시각적 geometry를 공유하는 frame이다. */
export function AuctionScreenFrame({ header, summary, details }: AuctionScreenFrameProps) {
  return (
    <div
      data-slot='auction-screen'
      className='mx-auto grid w-full max-w-5xl min-w-0 gap-6 px-4 py-8 sm:px-6 lg:px-8'
      aria-labelledby='auction-title'
    >
      <header>{header}</header>
      <section aria-label='공고 요약'>{summary}</section>
      <section aria-label='공고 출처'>{details}</section>
    </div>
  );
}
