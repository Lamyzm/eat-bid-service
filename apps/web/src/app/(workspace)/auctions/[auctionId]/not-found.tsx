export default function AuctionNotFound() {
  return (
    <main className='mx-auto grid w-full max-w-xl gap-3 px-4 py-16 text-center'>
      <h1 className='text-xl font-semibold'>공고를 찾을 수 없습니다</h1>
      <p className='text-sm text-muted-foreground'>주소의 공고 ID를 확인해 주세요.</p>
    </main>
  );
}
