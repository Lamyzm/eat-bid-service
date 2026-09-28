/**
 * @module 책임: 명단을 연 회차(attempt·revision)를 주소에 읽고 쓰며, 계약 모양이 아닌 값은 고른 것으로 치지 않는다.
 */
'use client';
import { useCallback } from 'react';
import { useQueryStates } from 'nuqs';
import { auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';
import { analysisSearchParsers } from '@/app/(workspace)/auctions/[auctionId]/_lib/analysis-search';

export interface RoundKey {
  readonly attemptId: string;
  readonly revisionId: string;
}

/**
 * 손으로 고친 주소의 회차 값은 계약의 id 모양으로만 받는다. 모양이 틀린 값을 조회에 넘기면 계약 검사가
 * 렌더 중에 던져 화면 전체가 오류 경계로 간다. 틀린 값은 "고른 회차 없음"이다.
 */
function roundKeyOf(round: string | null, revision: string | null): RoundKey | null {
  if (round === null || revision === null) return null;
  const path = auctionV1Operations.roster.pathSchema.safeParse({ auctionId: round });
  const query = auctionV1Operations.roster.querySchema.safeParse({ revisionId: revision });
  if (!path.success || !query.success || query.data.revisionId === undefined) return null;
  return { attemptId: path.data.auctionId, revisionId: query.data.revisionId };
}

export function useRoundSelection(): {
  readonly selected: RoundKey | null;
  readonly select: (key: RoundKey) => void;
  readonly clear: () => void;
} {
  const [{ round, roundRevision }, setRound] = useQueryStates(
    { round: analysisSearchParsers.round, roundRevision: analysisSearchParsers.roundRevision },
    // 표시 상태라 서버에 다시 묻지 않는다. 뒤로 가기가 회차 열기를 하나씩 되돌리지 않게 기록을 바꾼다.
    { shallow: true, history: 'replace', scroll: false }
  );
  const select = useCallback(
    (key: RoundKey) => void setRound({ round: key.attemptId, roundRevision: key.revisionId }),
    [setRound]
  );
  const clear = useCallback(() => void setRound({ round: null, roundRevision: null }), [setRound]);
  return { selected: roundKeyOf(round, roundRevision), select, clear };
}
