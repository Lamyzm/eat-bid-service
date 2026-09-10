/** @module 책임: 결정 화면 v2 셸을 조립하고 어느 본문이 집중 모드인지·회차 선택이 어느 표본을 보는지를 정한다. 계약이 있는 영역만 채우고 없는 영역은 수집 전 카드로 둔다. */
import './decision-layout.css';

import type { DecisionSearch } from '../_lib/decision-search-params';
import { attemptKeys } from '../_features/history/model/attempt-history';
import type { DecisionPageData } from '../_lib/load-auction-page';
import { presentOrgCadence } from '../_features/history/model/org-cadence';
import type { DecisionPresentation } from '../_lib/present-decision';
import { BidRail } from './bid-rail';
import { BidRateProvider } from '../_lib/bid-rate-context';
import { CurrentAuctionFacts } from './current-auction-facts';
import { DecisionFrame, type DecisionFocus } from './decision-frame';
import { DecisionHeader } from './decision-header';
import { DecisionFilters } from './decision-filters';
import { EvidenceTabs, HISTORY_PENDING_REASON } from './evidence-tabs';
import { EvidenceViews } from './evidence-view';
import { DecisionExpand } from './decision-expand';
import { HistoryBuildRecovery } from '../_features/history/ui/history-build-recovery';
import { HistoryCard } from './history-card';
import { PendingCard } from './pending-card';
import { RehearsalPanel } from '../_features/rehearsal/ui/rehearsal-panel';
import { AttemptSelectionProvider } from '../_lib/attempt-selection';
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
      {/* 지금 보는 근거는 화면 수준 상태다. 조건 줄의 분포 범위와 확대·내 값 링크도 근거 카드와 같은 값을
          봐야 서버 왕복 없이 바뀐 탭이 그 링크들에서 되돌아가지 않는다(EAT-139). */}
      <EvidenceViews initialView={search.view} expanded={search.expand !== null}>
        <AttemptSelectionProvider
          key={decision.identity.auctionId}
          // 이어 붙인 페이지까지 넘긴다. 첫 페이지만 주면 두 번째 페이지 회차가 "조회 밖"으로 판정돼
          // 고르는 즉시 선택이 풀린다(EAT-115). 필터가 회차를 실제로 뺐을 때만 선택을 초기화해야 한다.
          // 표 행이 아니라 회차 열쇠만 넘긴다 — 표와 차트가 이미 그린 행을 client provider로 한 벌 더
          // 보내면 그만큼 RSC 페이로드가 커진다(EAT-139).
          attempts={history.state === 'ready' ? attemptKeys(history.expanded.presentation.rows) : []}
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
                <div className='grid gap-2'>
                  <PendingCard title='과거 회차' reason={HISTORY_PENDING_REASON[history.state]} />
                  {/* build 전환은 조회 실패가 아니라 다시 읽으면 되는 사실이다. 복구 진입을 같은 자리에 둔다. */}
                  {history.state === 'build-changed' ? (
                    <HistoryBuildRecovery auctionId={decision.identity.auctionId} search={search} />
                  ) : null}
                </div>
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
      </EvidenceViews>
    </BidRateProvider>
  );
}
