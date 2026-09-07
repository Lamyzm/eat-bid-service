/** @module 책임: 과거 회차 크게 보기 본문 — 서버가 cursor를 따라 이어 붙인 회차를 12열 표로 그리고, 다음 페이지는 URL `pages`를 하나 올린 링크로 부른다. */
import Link from 'next/link';

import { buildDecisionHistoryPagesRoute, type DecisionSearch } from '../../_lib/decision-search-params';
import type { HistoryPresentation } from '../../_model/attempt-history';
import { HistoryExpandTable } from './history-expand-table';

/**
 * 페이지를 client에서 fetch하지 않고 주소로 부르는 이유: 응답 행을 표시 행으로 옮기는 `presentHistory`가
 * `@eatbid/domain`(Temporal)을 쓰는데 그 runtime은 client bundle에 넣지 않는다(apps/web AGENTS.md). 주소에
 * 남으니 불러온 만큼이 공유 링크와 뒤로 가기에도 그대로 살아 있다.
 */
export function HistoryExpand({
  auctionId,
  search,
  presentation,
  loadFailed,
  myRate
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  /** 요청한 페이지까지 이어 붙인 표시 모델. `nextCursor`가 null이면 이력 끝이다. */
  readonly presentation: HistoryPresentation;
  /** 이어 부르던 페이지 하나가 실패해 그 앞까지만 실렸다는 표시다. 실패를 "이력 끝"으로 꾸미지 않는다. */
  readonly loadFailed: boolean;
  readonly myRate: string | null;
}) {
  const rows = presentation.rows;
  return (
    <div className='grid min-w-0 gap-3'>
      <HistoryExpandTable rows={rows} myRate={myRate} />
      <div className='flex flex-wrap items-center gap-3'>
        <span data-slot='history-expand-count' className='text-[13px] font-semibold text-muted-foreground'>
          표본 {presentation.sampleCount.toLocaleString('ko-KR')}회 중 {rows.length.toLocaleString('ko-KR')}회 표시
        </span>
        {loadFailed ? (
          <span role='alert' className='text-[13px] font-medium text-destructive'>
            회차를 더 불러오지 못했습니다. 잠시 후 다시 열어 주세요.
          </span>
        ) : presentation.nextCursor === null ? (
          <span className='text-[13px] font-medium text-muted-foreground'>이력 끝</span>
        ) : (
          <Link
            href={buildDecisionHistoryPagesRoute(auctionId, search, search.pages + 1)}
            scroll={false}
            className='inline-flex h-9 items-center rounded-md bg-primary/10 px-3 text-[15px] font-semibold whitespace-nowrap text-primary'
          >
            더 불러오기
          </Link>
        )}
      </div>
    </div>
  );
}
