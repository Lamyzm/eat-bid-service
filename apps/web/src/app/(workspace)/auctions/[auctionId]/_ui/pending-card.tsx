/** @module 책임: 아직 계약이 없는 영역을 숨기지 않고 "수집 전"으로 정직하게 표시한다. */
export function PendingCard({ title, reason }: { readonly title: string; readonly reason: string }) {
  return (
    <div className='rounded-xl bg-card p-4 shadow-xs'>
      <div className='flex items-baseline gap-2'>
        <span className='text-xl font-bold'>{title}</span>
        <span className='text-[13px] font-semibold text-muted-foreground'>수집 전</span>
      </div>
      <p className='mt-2 text-[15px] font-medium text-muted-foreground'>{reason}</p>
    </div>
  );
}
