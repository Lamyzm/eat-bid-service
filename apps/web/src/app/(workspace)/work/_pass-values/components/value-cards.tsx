/**
 * @module 책임: 사업장마다 이달 하한 90% 값과, 그 사업장에 보낼 글을 한 번에 복사하는 넘겨주기 카드를 그린다. 값은 한 곳에서 보고
 * 사업장마다 카톡·전화로 넘겨주므로 카드가 사업장 하나의 단위다.
 */
import { CopyValue } from '@/shared/ui/copy-value';
import { Icons } from '@/shared/ui/icons';

import type { ValueCard } from '../utils/work-board';

export function ValueCards({
  monthLabel,
  cards
}: {
  readonly monthLabel: string;
  readonly cards: readonly ValueCard[];
}) {
  return (
    <section aria-labelledby='work-values-title' className='grid gap-3'>
      <h2 id='work-values-title' className='text-body font-bold'>
        {monthLabel}
      </h2>
      <ul className='grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]'>
        {cards.map((card, index) => (
          <li
            key={`${index}-${card.name}`}
            className='grid content-start gap-2 rounded-panel bg-card p-5'
          >
            <p className='truncate text-body font-bold' title={card.name}>
              {card.name}
            </p>
            <div className='grid gap-0.5'>
              <span className='text-label font-semibold text-ink-3'>하한 90%</span>
              {card.value90 === null ? (
                <span className='text-body font-semibold text-muted-foreground'>
                  {card.reason90 ?? '—'}
                </span>
              ) : (
                <CopyValue
                  value={card.value90}
                  label={`${card.name} 하한 90% 값`}
                  className='inline-flex items-center gap-2 justify-self-start rounded-chip hover:underline'
                >
                  <span className='text-value font-extrabold tabular-nums'>{card.value90}%</span>
                  <Icons.copy aria-hidden className='size-6 text-muted-foreground' />
                </CopyValue>
              )}
            </div>
            <CopyValue
              value={card.passText}
              label={`${card.name}에 보낼 값`}
              className='pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-secondary px-4 text-body font-bold text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]'
            >
              넘겨주기
            </CopyValue>
          </li>
        ))}
      </ul>
    </section>
  );
}
