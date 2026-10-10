/** @module 책임: 비교 성적 막대 목록을 그린다. 막대 길이와 순서는 성적 모델이 정하고 여기서는 다시 계산하지 않는다. */
import type { MarketPickBar } from './market-pick-record';

export function RecordBarList({ bars }: { readonly bars: readonly MarketPickBar[] }) {
  return (
    <ul className='space-y-1.5'>
      {bars.map((bar) => (
        <li
          key={bar.label}
          className={`grid grid-cols-[7.5em_1fr_4em] items-center gap-2 text-xs tabular-nums ${bar.mine ? 'font-semibold' : ''}`}
        >
          <span>{bar.label}</span>
          <span aria-hidden='true' className='block h-2.5 overflow-hidden rounded-sm bg-muted'>
            <span
              className={`block h-full rounded-sm ${bar.mine ? 'bg-primary' : 'bg-muted-foreground/40'}`}
              style={{ width: `${bar.widthPercent}%` }}
            />
          </span>
          <span className='text-right'>{bar.value}</span>
        </li>
      ))}
    </ul>
  );
}
