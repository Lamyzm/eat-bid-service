'use client';
/** @module 책임: 행의 공고번호를 누르면 클립보드에 복사되는 손잡이다. 투찰은 eaT에서 일어나므로 이 번호는 eaT 검색창에 붙여 넣는 값이다. */
import { CopyValue } from '@/shared/ui/copy-value';

export function CopyBidNo({ value }: { readonly value: string }) {
  return (
    <CopyValue value={value} label='공고번호'>
      <span>{value}</span>
    </CopyValue>
  );
}
