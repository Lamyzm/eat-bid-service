'use client';
/** @module 책임: 행의 공고번호를 누르면 클립보드에 복사되는 손잡이를 그린다. 투찰은 eaT에서 일어나므로 이 번호는 eaT 검색창에 붙여 넣는 값이며, 복사됐다는 사실을 눈과 낭독기 둘 다에 알린다. */
import { useState } from 'react';

import { MUTED } from './open-auction-cells';

export function CopyBidNo({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    // 클립보드가 막힌 브라우저(권한 거부·비보안 문맥)에서는 조용히 실패한다. 번호는 여전히 화면에 있어 손으로 옮길 수 있다.
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type='button'
      onClick={copy}
      onBlur={() => setCopied(false)}
      className={`${MUTED} inline-flex items-baseline gap-1 rounded tabular-nums hover:text-foreground hover:underline`}
    >
      {/* 이름은 "무엇을 하는 버튼인가"와 "어느 번호인가"다. 번호만 읽어 주면 낭독기 사용자는 이것이 복사
          손잡이인지 모르고, 동사만 읽어 주면 어느 행의 번호인지 모른다. 눈에는 번호만 보인다. */}
      <span className='sr-only'>공고번호 복사 </span>
      <span>{value}</span>
      <span role='status' className={copied ? 'font-semibold text-foreground' : 'sr-only'}>{copied ? '복사됨' : ''}</span>
    </button>
  );
}
