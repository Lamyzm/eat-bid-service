/** @module 책임: build 전환으로 닫힌 회차 이력·내 투찰을 cached→latest 자동 전환 한 번과 latest에서의 명시적 재시도로 복구하는 클라이언트 경계를 소유한다. */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Button } from '@/shared/ui/button';
import { buildDecisionHistoryReadRoute, type DecisionSearch } from '../_lib/decision-search-params';

/**
 * cached 주소에서 만난 409는 latest 주소로 한 번 옮긴다. latest에서 다시 만나면 버튼만 남기고 자동 이동을
 * 반복하지 않는다 — 같은 전환을 계속 돌면 발행이 잦은 시간대에 화면이 스스로 무한 재진입한다.
 * `router.replace`라 뒤로 가기에 cached 주소가 남지 않고, latest 주소는 유한 값 하나라 nonce처럼 늘지 않는다.
 */
export function BuildRecovery({
  auctionId,
  search,
  subject
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  /** 무엇을 다시 불러오는지 사용자 문장에 넣을 이름이다. 예: '회차 이력', '내 투찰'. */
  readonly subject: string;
}) {
  const router = useRouter();
  const latest = search.historyRead === 'latest';
  const target = buildDecisionHistoryReadRoute(auctionId, search, 'latest');
  useEffect(() => {
    if (!latest) router.replace(target);
  }, [latest, router, target]);
  if (!latest) {
    return (
      <p role='status' className='text-sm text-muted-foreground'>
        자료가 방금 갱신되어 {subject}을 새 기준으로 다시 불러옵니다.
      </p>
    );
  }
  return (
    <div role='alert' className='flex flex-wrap items-center gap-3 text-sm'>
      <span>자료 기준이 다시 바뀌어 {subject}을 불러오지 못했습니다.</span>
      {/* latest에서는 RSC를 다시 실행해야 새 build를 읽는다. 같은 주소의 refresh가 그 경로다. */}
      <Button variant='outline' size='sm' onClick={() => router.refresh()}>
        다시 불러오기
      </Button>
    </div>
  );
}

export function HistoryBuildRecovery(props: { readonly auctionId: string; readonly search: DecisionSearch }) {
  return <BuildRecovery {...props} subject='회차 이력' />;
}
