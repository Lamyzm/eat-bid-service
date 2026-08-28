'use client';
import { Button } from '@/components/ui/button';

/**
 * 조회 실패 고지 — 빈 상태와 구분해서 보여준다.
 * "없습니다"와 "못 받았습니다"는 다른 사실이다.
 *
 * 문구를 호출부에서 짓지 않는다. `.catch` 를 고칠 때마다 문장을 새로 지으면
 * "불러오지 못했습니다"가 스무 가지 표기로 갈린다 — 지역 이름에서 이미 겪은 구조다.
 * 호출부는 무엇을 못 받았는지(what)만 넘기고, 문장은 여기서 만든다.
 */

/** 받침이 있으면 '을', 없으면 '를' */
function objectParticle(word: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return '을';
  return (code - 0xac00) % 28 === 0 ? '를' : '을';
}

export function loadErrorMessage(what: string): string {
  return `${what}${objectParticle(what)} 불러오지 못했습니다.`;
}

export function LoadError({
  what, detail, onRetry, inline = false,
}: {
  /** 못 받은 것 — "공고 목록", "개찰 결과" 처럼 명사구만 */
  what: string;
  /** 그래서 화면이 무엇을 보여주고 있는지 (선택) */
  detail?: string;
  onRetry?: () => void;
  /** 표 칸·설명 줄 안에 들어갈 때 */
  inline?: boolean;
}) {
  const message = loadErrorMessage(what);

  if (inline) {
    return (
      <span className='text-destructive text-xs'>
        {message}
        {detail && <span className='text-muted-foreground'> {detail}</span>}
      </span>
    );
  }

  return (
    <div className='flex flex-wrap items-center justify-center gap-3 py-8 text-center text-sm'>
      <span className='text-destructive font-medium'>{message}</span>
      {detail && <span className='text-muted-foreground'>{detail}</span>}
      {onRetry && <Button size='sm' variant='outline' onClick={onRetry}>다시 시도</Button>}
    </div>
  );
}
