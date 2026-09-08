/** @module 책임: 결정 화면 v2 셸을 조립한다. 계약이 있는 영역만 채우고 없는 영역은 수집 전 카드로 둔다. */
import Link from 'next/link';
import './decision-layout.css';

import { buildDecisionExpandRoute, type DecisionSearch } from '../_lib/decision-search-params';
import type { HistoryPresentation } from '../_model/attempt-history';
import { historyWindow, historyWindowText } from '../_model/history-window';
import type { DecisionPageData } from '../_model/load-auction-page';
import { presentOrgCadence } from '../_model/org-cadence';
import type { DecisionPresentation } from '../_model/present-decision';
import { BidRail } from './bid-rail';
import { BidRateProvider } from './bid-rate-context';
import { DecisionBanner } from './decision-banner';
import { DecisionFrame } from './decision-frame';
import { DecisionHeader } from './decision-header';
import { DecisionFilters } from './decision-filters';
import { EvidenceTabs, HISTORY_PENDING_REASON } from './evidence-tabs';
import { DecisionExpand } from './expand/decision-expand';
import { HistoryTable } from './history-table';
import { PendingCard } from './pending-card';
import { RehearsalPanel } from './rehearsal-panel';
import { AttemptSelectionProvider } from './attempt-selection';
import { SelectedAttemptRail } from './auction-roster-panel';

type HistoryState = DecisionPageData['history'];
type DistributionState = DecisionPageData['distribution'];

function HistoryCard({
  presentation,
  auctionId,
  search
}: {
  readonly presentation: HistoryPresentation;
  readonly auctionId: string;
  readonly search: DecisionSearch;
}) {
  return (
    <div data-slot='history-card' className='overflow-hidden rounded-xl bg-card shadow-xs'>
      <div className='flex flex-wrap items-baseline gap-2 px-4 pt-4'>
        <span className='text-xl font-bold'>과거 회차</span>
        {/* 표본 수는 전체 회차지만 표가 그리는 행은 상한에 걸린다. 실제로 그린 행 수를 적어야
            "12회 표시"가 5행짜리 기관에서 거짓이 되지 않는다. 세는 일은 _model이 하고 여기서는 그
            결과 문구만 놓는다. */}
        <span className='text-[13px] font-semibold text-muted-foreground'>
          {historyWindowText(historyWindow(presentation.sampleCount, presentation.rows.length))}
        </span>
        {/* 12행 상한을 푼 12열 표는 모달(expand=과거 회차)이 그린다. 열림은 주소이므로 링크 하나면 된다. */}
        <Link
          href={buildDecisionExpandRoute(auctionId, search, '과거 회차')}
          scroll={false}
          className='ml-auto text-[13px] font-semibold whitespace-nowrap text-primary'
        >
          크게 보기
        </Link>
      </div>
      <HistoryTable rows={presentation.rows} />
    </div>
  );
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
  // 누적 회차·발주 주기·지난 공고는 헤더와 배너가 같은 계산을 봐야 한다. 두 곳에서 따로 세면 표본이 어긋난다.
  const cadence = presentOrgCadence(history, { announcedAt: decision.announcedAt });

  return (
    // 손잡이는 사용자가 주소에 남긴 값으로만 시작한다. 여기서 값을 정해 주면 그것이 추천값이 된다(AGENTS 8, EAT-84).
    <BidRateProvider initialRate={search.rate}>
      <AttemptSelectionProvider
        key={decision.identity.auctionId}
        rows={history.state === 'ready' ? history.presentation.rows : []}
      >
        <DecisionFrame
          focus={search.expand === '흐름' && search.view === '흐름'}
          header={<DecisionHeader decision={decision} cadence={cadence} />}
          banner={<DecisionBanner decision={decision} cadence={cadence} />}
          filters={<DecisionFilters decision={decision} search={search} history={history.state === 'ready' ? history.presentation : undefined} />}
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
                presentation={history.presentation}
                auctionId={decision.identity.auctionId}
                search={search}
              />
            ) : (
              <PendingCard title='과거 회차' reason={HISTORY_PENDING_REASON[history.state]} />
            )
          }
          rail={
            <SelectedAttemptRail
              fallback={decision.railState === 'closed' ? null :
                <BidRail
                  decision={decision}
                  rehearsal={
                    history.state === 'ready' ? <RehearsalPanel rows={selectedRows} /> : null
                  }
                />
              }
            />
          }
        />
        {/* 크게 보기 모달은 URL expand가 열고 닫는다. 프레임 밖에 두어 section 순서 검사에 섞이지 않게 한다. */}
        <DecisionExpand
          decision={decision}
          search={search}
          history={history}
          distribution={distribution}
        />
      </AttemptSelectionProvider>
    </BidRateProvider>
  );
}
