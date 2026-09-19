/** @module 책임: 주소에 실린 비교조건 전체를 지워 공고가 들고 온 기본 조건으로 되돌린다. */
'use client';
import { useQueryState } from 'nuqs';
import { useTransition } from 'react';
import { analysisSearchParsers } from '@/app/(workspace)/auctions/[auctionId]/analysis/_lib/analysis-search';
import { Button } from '@/shared/ui/button';

/**
 * 조건 막대가 아니라 탭 줄에 선다. 조건이 아홉 개라 막대에는 남는 폭이 없고, 막대 안에 두면 조건을
 * 고친 순간 버튼이 나타나며 칸 하나를 다음 줄로 밀어 **되돌리려 할 때마다 막대가 커진다**
 * (1024px 실측 92 → 130px).
 *
 * 되돌리기는 주소에서 조건을 지우는 일이다. 초안을 기본값으로 되쓰지 않는 이유는, 조건의 진실
 * 원천이 주소이고 화면은 그것을 읽어 서기 때문이다 — 지우면 `readAppliedAnalysis`가 공고의 기본
 * 조건을 다시 만든다. 그래서 이 버튼은 조건 폼의 상태를 알 필요가 없다.
 */
export function AnalysisResetButton() {
  const [, startTransition] = useTransition();
  const [applied, setApplied] = useQueryState(
    'analysis',
    analysisSearchParsers.analysis.withOptions({
      shallow: false,
      history: 'push',
      scroll: false,
      startTransition
    })
  );
  // 되돌릴 것이 없으면 내지 않는다. 눌러도 아무 일이 없는 버튼은 고장으로 읽힌다.
  if (applied === null) return null;
  return (
    <Button
      type='button'
      size='sm'
      variant='ghost'
      className='h-8 px-2 underline-offset-4 hover:underline'
      onClick={() => void setApplied(null)}
    >
      조건 초기화
    </Button>
  );
}
