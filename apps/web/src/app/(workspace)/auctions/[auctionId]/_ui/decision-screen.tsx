/** @module 책임: 결정 화면 v2 셸을 조립하고 어느 본문이 집중 모드인지·회차 선택이 어느 표본을 보는지를 정한다. 계약이 있는 영역만 채우고 없는 영역은 수집 전 카드로 둔다. */
import './decision-layout.css';

import type { DecisionSearch } from '../_lib/decision-search-params';
import type { DecisionPageData } from '../_model/load-auction-page';
import { presentOrgCadence } from '../_model/org-cadence';
import type { DecisionPresentation } from '../_model/present-decision';
import { BidRail } from './bid-rail';
import { BidRateProvider } from './bid-rate-context';
import { CurrentAuctionFacts } from './current-auction-facts';
import { DecisionFrame, type DecisionFocus } from './decision-frame';
import { DecisionHeader } from './decision-header';
import { DecisionFilters } from './decision-filters';
import { EvidenceTabs, HISTORY_PENDING_REASON } from './evidence-tabs';
import { DecisionExpand } from './expand/decision-expand';
import { HistoryCard } from './history-card';
import { PendingCard } from './pending-card';
import { RehearsalPanel } from './rehearsal-panel';
import { AttemptSelectionProvider } from './attempt-selection';
import { AuctionWorkspaceDock } from './auction-workspace-dock';

type HistoryState = DecisionPageData['history'];
type DistributionState = DecisionPageData['distribution'];

/**
 * 확대는 같은 본문의 높이 배분만 바꾼다. 과거 회차는 그릴 회차가 있을 때만 집중 모드로 들어가고,
 * 비교집단은 유일하게 모달로 열려 여기서는 어떤 본문도 키우지 않는다.
 */
function focusOf(search: DecisionSearch, history: HistoryState): DecisionFocus | undefined {
  if (search.expand === '과거 회차') return history.state === 'ready' ? 'history' : undefined;
  if (search.expand === '흐름' && search.view === '흐름') return 'flow';
  return undefined;
}

export function DecisionScreen({
  decision,
  search,
  history,
  distribution
}: {
  readonly decision: DecisionPresentation;
  readonly search: DecisionSearch;
  readonly history: HistoryState;
  readonly distribution: DistributionState;
}) {
  // 선택 품목이 아닌 회차는 경쟁 구조가 달라 같은 분모에 넣으면 거짓이 된다. "이 값이면"은 선택
  // 품목 회차만 센다.
  const selectedRows =
    history.state === 'ready' ? history.presentation.rows.filter((row) => row.isSelectedItem) : [];
  // 누적 회차·발주 주기·지난 공고는 오른쪽 현재 공고 패널이 읽는다. 두 곳에서 따로 세면 표본이 어긋난다.
  const cadence = presentOrgCadence(history, { announcedAt: decision.announcedAt });
  const focus = focusOf(search, history);

  return (
    // 손잡이는 사용자가 주소에 남긴 값으로만 시작한다. 여기서 값을 정해 주면 그것이 추천값이 된다(AGENTS 8, EAT-84).
    <BidRateProvider initialRate={search.rate}>
      <AttemptSelectionProvider
        key={decision.identity.auctionId}
        // 이어 붙인 페이지까지 넘긴다. 첫 페이지만 주면 두 번째 페이지 회차가 "조회 밖"으로 판정돼
        // 고르는 즉시 선택이 풀린다(EAT-115). 필터가 회차를 실제로 뺐을 때만 선택을 초기화해야 한다.
        rows={history.state === 'ready' ? history.expanded.presentation.rows : []}
      >
        <DecisionFrame
          focus={focus}
          header={<DecisionHeader decision={decision} />}
          filters={
            <DecisionFilters
              decision={decision}
              search={search}
              history={history.state === 'ready' ? history.presentation : undefined}
            />
          }
          evidence={
            <div data-slot='decision-evidence-stack' className='grid gap-4'>
              <EvidenceTabs
                auctionId={decision.identity.auctionId}
                search={search}
                history={history}
                distribution={distribution}
              />
            </div>
          }
          history={
            history.state === 'ready' ? (
              <HistoryCard
                auctionId={decision.identity.auctionId}
                search={search}
                history={history}
                focused={focus === 'history'}
              />
            ) : (
              <PendingCard title='과거 회차' reason={HISTORY_PENDING_REASON[history.state]} />
            )
          }
        />
        <AuctionWorkspaceDock
          fallback={
            <>
              <CurrentAuctionFacts decision={decision} cadence={cadence} />
              {decision.railState === 'closed' ? null : (
                <BidRail
                  decision={decision}
                  rehearsal={
                    history.state === 'ready' ? <RehearsalPanel rows={selectedRows} /> : null
                  }
                />
              )}
            </>
          }
        />
        {/* 비교집단 히트맵만 모달이다. 열림은 주소가 정하고 프레임 밖에 두어 section 순서 검사에 섞이지 않게 한다. */}
        <DecisionExpand decision={decision} search={search} distribution={distribution} />
      </AttemptSelectionProvider>
    </BidRateProvider>
  );
}
