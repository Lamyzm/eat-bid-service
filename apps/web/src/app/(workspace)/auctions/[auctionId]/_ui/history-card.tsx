/** @module 책임: 과거 회차 카드의 제목·표본 문구·확대 진입을 소유하고, 일반 12행과 확대 누적 행 중 무엇을 같은 회차 표에 넘길지 정한다. */
import type { DecisionSearch } from '../_lib/decision-search-params';
import type { HistoryPresentation } from '../_model/attempt-history';
import { HISTORY_WINDOW_LIMIT, historyWindow, historyWindowText } from '../_model/history-window';
import { DecisionExpandLink } from './expand/decision-expand-link';
import { HistoryExpandPager } from './expand/history-expand';
import { loadedRangeText } from './expand/history-range';
import { HistoryTable } from './history-table';

type ReadyHistory = {
  readonly presentation: HistoryPresentation;
  readonly expanded: { readonly presentation: HistoryPresentation; readonly loadFailed: boolean };
};

/**
 * 조회 조건이 바뀌면 다른 집단이므로 표의 스크롤 기억을 물려받으면 안 된다. 확대 전환과 "더 불러오기"는
 * 같은 집단을 계속 보는 것이라 key가 그대로여야 표 DOM과 그 위치가 살아남는다(EAT-115).
 */
function cohortKey(search: DecisionSearch): string {
  return `${search.period}|${search.floor ?? ''}|${search.item ?? ''}`;
}

/**
 * 확대는 이 카드가 그리는 행 수와 페이지 진입만 바꾼다. 표·열·기록 버튼은 같은 `HistoryTable`이고
 * 모달이 아니므로 오른쪽 참여 기록이 확대 표에 가리지 않는다. 표를 두 분기에서 각각 감싸면 같은
 * 컴포넌트여도 DOM이 다시 마운트돼 확대 위치를 잃으므로 자리를 하나로 고정한다(EAT-115).
 */
export function HistoryCard({
  auctionId,
  search,
  history,
  focused
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  readonly history: ReadyHistory;
  readonly focused: boolean;
}) {
  // 표본 수는 전체 회차지만 표가 그리는 행은 일반 보기에서 상한에 걸린다. 실제로 그린 행 수를 적어야
  // "12회 표시"가 5행짜리 기관에서 거짓이 되지 않는다. 세는 일은 _model이 하고 여기서는 문구만 놓는다.
  const expandedPresentation = history.expanded.presentation;
  const rows = focused
    ? expandedPresentation.rows
    : history.presentation.rows.slice(0, HISTORY_WINDOW_LIMIT);
  const range = loadedRangeText(expandedPresentation.rows);
  const caption = focused
    ? [`${expandedPresentation.sampleCount.toLocaleString('ko-KR')}회`, range].filter((part) => part !== null).join(' · ')
    : historyWindowText(historyWindow(history.presentation.sampleCount, rows.length));

  return (
    <div data-slot='history-card' className='min-w-0 overflow-hidden rounded-xl bg-card shadow-xs'>
      <div className='flex flex-wrap items-center gap-2 px-4 pt-4 pb-2'>
        <span className='text-xl font-bold'>과거 회차</span>
        <span className='text-[13px] font-semibold text-muted-foreground'>{caption}</span>
        {/* 12행 상한을 푼 표는 같은 본문의 집중 모드가 그린다. 열림은 주소이므로 차트 확대와 같은 링크를 쓴다. */}
        <DecisionExpandLink auctionId={auctionId} search={search} target='과거 회차' />
      </div>
      <HistoryTable key={cohortKey(search)} rows={rows} />
      {focused ? (
        <HistoryExpandPager
          auctionId={auctionId}
          search={search}
          presentation={expandedPresentation}
          loadFailed={history.expanded.loadFailed}
        />
      ) : null}
    </div>
  );
}
