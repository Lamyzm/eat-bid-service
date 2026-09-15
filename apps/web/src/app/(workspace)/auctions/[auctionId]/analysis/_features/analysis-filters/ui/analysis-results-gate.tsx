/** @module 책임: 현재 URL과 응답 조건이 다른 동안 이전 표본을 감추고 재조회 상태를 표시한다. */
'use client';
import { useQueryState } from 'nuqs';
import type { ReactNode } from 'react';
import { analysisSearchParsers } from '@/app/(workspace)/auctions/[auctionId]/analysis/_lib/analysis-search';

export function AnalysisResultsGate({
  requestKey,
  children
}: {
  readonly requestKey: string | null;
  readonly children: ReactNode;
}) {
  const [current] = useQueryState('analysis', analysisSearchParsers.analysis);
  if (current !== requestKey)
    return (
      <p role='status' className='px-8 py-16 text-center text-sm text-muted-foreground'>
        비교조건을 적용하고 있어요.
      </p>
    );
  return children;
}
