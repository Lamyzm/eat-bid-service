/** @module 책임: 유효하지 않거나 존재하지 않는 공고 ID의 안전한 404 화면을 제공한다. */
export default function AuctionNotFound() {
  return (
    <section
      className='mx-auto grid w-full max-w-xl gap-3 px-4 py-16 text-center'
      aria-labelledby='auction-not-found-title'
    >
      <h1 id='auction-not-found-title' className='text-xl font-semibold'>
        공고를 찾을 수 없습니다
      </h1>
      <p className='text-sm text-muted-foreground'>주소의 공고 ID를 확인해 주세요.</p>
    </section>
  );
}
