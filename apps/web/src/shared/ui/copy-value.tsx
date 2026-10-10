'use client';
/**
 * @module 책임: 누르면 넘겨받은 값을 클립보드에 복사하고 그 사실을 눈과 낭독기 둘 다에 알리는 손잡이를 그린다. 투찰은 eaT에서
 * 일어나므로 이 값은 사용자가 eaT 입력칸에 직접 붙여 넣는 것이다 — 화면은 붙여 넣지 않는다(AGENTS 8).
 */
import { useState, type ReactNode } from 'react';

export function CopyValue({
  value,
  label,
  children,
  className
}: {
  /** 클립보드에 들어갈 값이다. 금액이면 쉼표·단위 없는 숫자다 — 보이는 글자(`children`)와 다를 수 있다. */
  readonly value: string;
  /** 낭독기가 읽을 대상 이름이다. "{label} 복사"로 읽힌다. */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    // 클립보드가 막힌 브라우저(권한 거부·비보안 문맥)에서는 조용히 실패한다. 값은 여전히 화면에 있어 손으로 옮길 수 있다.
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
      className={className ?? 'inline-flex items-baseline gap-1 rounded tabular-nums hover:text-foreground hover:underline'}
    >
      {/* 이름은 "무엇을 하는 버튼인가"와 "어느 값인가"다. 값만 읽어 주면 복사 손잡이인지 모르고, 동사만 읽어 주면 어느
          값인지 모른다. 눈에는 값만 보인다. */}
      <span className='sr-only'>{label} 복사 </span>
      {children}
      <span role='status' className={copied ? 'font-semibold text-foreground' : 'sr-only'}>
        {copied ? '복사됨' : ''}
      </span>
    </button>
  );
}
