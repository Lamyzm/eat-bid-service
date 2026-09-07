/** @module 책임: 근거 카드의 탭 스트립·안내문·범례를 그리고 URL의 view 값에 해당하는 본문 하나와 그 탭의 크게 보기 링크를 렌더링한다. 수집 전 사유 문구는 여기 한 곳이 소유해 모달과 같은 말을 한다. */
import Link from 'next/link';

import {
  DECISION_VIEWS,
  buildDecisionExpandRoute,
  buildDecisionViewRoute,
  type DecisionSearch,
  type DecisionView
} from '../_lib/decision-search-params';
import type { DecisionPageData } from '../_model/load-auction-page';
import { DistributionFootnote } from './distribution-footnote';
import { FlowChart } from './flow-chart';
import { MyRateInput } from './my-rate-input';
import { OrderBook } from './order-book';
import { OrderBookSummary } from './order-book-summary';

type HistoryState = DecisionPageData['history'];
type DistributionState = DecisionPageData['distribution'];

// 탭마다 이 화면이 무엇을 보여 주는지 한 줄로 말한다. 본문이 아직 없는 탭도 무엇이 올 자리인지는
// 밝힌다. 빈 카드는 사용자에게 "고장"으로 읽힌다. 비교집단은 지금 모집단이 무엇인지가 문장의
// 일부라 조건에서 읽어 넣는다.
function note(view: DecisionView, scope: DecisionSearch['scope']): string {
  switch (view) {
    case '비교집단':
      return `${scope}에서 값마다 낙찰된 횟수입니다. 모집단은 위 필터에서 바꿉니다.`;
    // 디자인 원문은 "파란 선"이지만 이 저장소의 primary 토큰은 파랑이 아니다. 색 이름 대신 굵기로
    // 가리켜 테마가 바뀌어도 문구가 거짓이 되지 않게 한다.
    case '흐름':
      return '회차마다 낙찰된 사정률입니다. 굵은 선이 내 값입니다.';
    case '그날 하한':
      return '가로 0은 그날 하한입니다. 낙찰값은 늘 그 바로 위입니다.';
    case '업체':
      return '이 기관 회차에 참여한 업체와 그 업체가 선 자리입니다.';
  }
}

/** 계약이 아직 없는 탭의 사유. 탭 본문과 크게 보기 모달이 같은 문장을 써야 한다. */
export const EXPAND_PENDING_REASON: Record<Exclude<DecisionView, '비교집단' | '흐름'>, string> = {
  '그날 하한': '회차별 하한 자리 계약이 붙으면 이 탭이 보입니다.',
  업체: '회차별 명단 계약이 붙으면 참여 업체가 보입니다.'
};

/**
 * 분포를 못 그린 이유. 재료가 없는 것(locked)과 조회가 실패한 것(unavailable)은 사용자가 할 일이
 * 다르다. 앞은 수집이 더 필요하고 뒤는 다시 열어보면 될 수 있다.
 */
export const DISTRIBUTION_PENDING_REASON: Record<'missing-terms' | 'missing-axis' | 'unavailable', string> = {
  'missing-terms': '이 공고의 하한율과 낙찰방식이 아직 수집되지 않았습니다',
  'missing-axis': '이 모집단을 만들 지역·기관이 아직 정규화되지 않았습니다',
  unavailable: '분포를 지금 불러오지 못했습니다'
};

/**
 * 이력을 못 부른 이유를 화면이 그대로 말한다. 두 경우는 사용자가 할 일이 다르다. 기관 미정규화는
 * 수집이 더 필요하다는 뜻이고 조회 실패는 다시 열어보면 될 수 있다. 흐름 탭과 과거 회차 카드가
 * 같은 사유를 말해야 하므로 문구는 여기 한 곳만 소유한다.
 */
export const HISTORY_PENDING_REASON: Record<Exclude<HistoryState['state'], 'ready'>, string> = {
  'no-organization': '이 공고의 구매기관이 아직 정규화되지 않았습니다',
  unavailable: '회차 이력을 지금 불러오지 못했습니다'
};

/** 빈 자리에도 사유를 붙인다. 사유 없는 빈 카드·빈 모달은 사용자에게 "고장"으로 읽힌다. */
export function PendingBody({ reason, label = '수집 전' }: { readonly reason: string; readonly label?: '수집 전' | '미확인' }) {
  return (
    <p className='flex items-baseline gap-2 text-[15px] font-medium text-muted-foreground'>
      <span className='text-[13px] font-semibold whitespace-nowrap'>{label}</span>
      <span>{reason}</span>
    </p>
  );
}

// 범례는 이번 슬라이스에서 스위치가 아니라 색 이름표다. 상태를 색만으로 전달하지 않기 위해 차트 옆에
// 늘 붙여 둔다.
const LEGEND: readonly { readonly mark: string; readonly name: string; readonly tone: string }[] = [
  { mark: '━', name: '낙찰', tone: 'text-foreground' },
  { mark: '━', name: '내 값', tone: 'text-primary' },
  { mark: '━', name: '그날 하한', tone: 'text-destructive' },
  { mark: '○', name: '다른 품목', tone: 'text-muted-foreground' }
];

export function FlowLegend() {
  return (
    <span className='ml-auto inline-flex items-center gap-2 text-[13px] font-semibold'>
      {LEGEND.map((item, index) => (
        <span key={item.name} className='inline-flex items-center gap-2'>
          {index > 0 ? <span className='text-muted-foreground/50'>·</span> : null}
          <span className={`whitespace-nowrap ${item.tone}`}>
            {item.mark} {item.name}
          </span>
        </span>
      ))}
    </span>
  );
}

// 흐름 차트의 내 값 선은 호가창과 같은 사정률 값(URL `myRate`)을 쓴다. 두 탭이 다른 "내 값"을 그리면
// 사용자가 같은 줄을 두 번 놓아야 한다(PDR-0004).
function FlowBody({ history, myRate }: { readonly history: HistoryState; readonly myRate: string | null }) {
  if (history.state !== 'ready') return <PendingBody reason={HISTORY_PENDING_REASON[history.state]} />;
  return <FlowChart presentation={history.presentation} myRate={myRate} />;
}

function CohortBody({
  auctionId,
  search,
  distribution
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  readonly distribution: DistributionState;
}) {
  if (distribution.state !== 'ready') {
    const reason = distribution.state === 'locked' ? distribution.reason : 'unavailable';
    return <PendingBody reason={DISTRIBUTION_PENDING_REASON[reason]} />;
  }
  const { presentation } = distribution;
  return (
    <div className='grid min-w-0 gap-3'>
      <MyRateInput auctionId={auctionId} search={search} />
      {presentation.ladder === null ? (
        // 회색 자리도 사유를 말한다.
        <PendingBody label='미확인' reason={presentation.reason ?? ''} />
      ) : (
        <>
          <OrderBookSummary ladder={presentation.ladder} />
          <OrderBook ladder={presentation.ladder} caption={`${search.scope} · 값마다 낙찰된 횟수`} />
        </>
      )}
      <DistributionFootnote meta={presentation.meta} scope={search.scope} />
    </div>
  );
}

/**
 * 탭마다 늘 있는 크게 보기 링크. 모달은 주소(`expand=<탭>`)가 열므로 링크 하나면 되고, 본문이 수집 전이어도
 * 링크는 남는다 — 모달이 같은 사유를 말한다. 같은 화면 안 주소 변경이라 스크롤 위치는 그대로 둔다.
 */
function ExpandLink({ auctionId, search }: { readonly auctionId: string; readonly search: DecisionSearch }) {
  return (
    <Link
      href={buildDecisionExpandRoute(auctionId, search, search.view)}
      scroll={false}
      className='ml-auto text-[13px] font-semibold whitespace-nowrap text-primary'
    >
      크게 보기
    </Link>
  );
}

export function EvidenceTabs({
  auctionId,
  search,
  history,
  distribution
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  readonly history: HistoryState;
  readonly distribution: DistributionState;
}) {
  const active = search.view;

  return (
    <div className='flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl bg-card p-4 shadow-xs'>
      <div className='flex min-w-0 flex-wrap items-center gap-1'>
        <nav aria-label='근거 보기' className='flex flex-wrap items-center gap-1'>
          {DECISION_VIEWS.map((view) => (
            <Link
              key={view}
              href={buildDecisionViewRoute(auctionId, search, view)}
              aria-current={view === active ? 'page' : undefined}
              className={`inline-flex h-9 items-center rounded-md px-3 text-[15px] whitespace-nowrap ${
                view === active ? 'bg-primary/10 font-semibold text-primary' : 'font-medium text-muted-foreground'
              }`}
            >
              {view}
            </Link>
          ))}
        </nav>
        {active === '흐름' ? <FlowLegend /> : null}
      </div>
      <p className='text-[13px] font-medium text-muted-foreground'>{note(active, search.scope)}</p>
      {active === '비교집단' ? (
        <CohortBody auctionId={auctionId} search={search} distribution={distribution} />
      ) : active === '흐름' ? (
        <FlowBody history={history} myRate={search.myRate} />
      ) : (
        <PendingBody reason={EXPAND_PENDING_REASON[active]} />
      )}
      <div className='flex'>
        <ExpandLink auctionId={auctionId} search={search} />
      </div>
    </div>
  );
}
