/** @module 책임: 근거 카드의 탭 스트립·안내문·범례를 그리고 URL의 view 값에 해당하는 본문 하나만 렌더링한다. */
import Link from 'next/link';

import {
  DECISION_VIEWS,
  decisionViewQuery,
  type DecisionSearch,
  type DecisionView
} from '../_lib/decision-search-params';
import type { DecisionPageData } from '../_model/load-auction-page';
import { FlowChart } from './flow-chart';

type HistoryState = DecisionPageData['history'];

// 탭마다 이 화면이 무엇을 보여 주는지 한 줄로 말한다. 본문이 아직 없는 탭도 무엇이 올 자리인지는
// 밝힌다. 빈 카드는 사용자에게 "고장"으로 읽힌다.
const NOTE: Record<DecisionView, string> = {
  비교집단: '값마다 낙찰된 횟수입니다. 모집단은 위 조건에서 바꿉니다.',
  // 디자인 원문은 "파란 선"이지만 이 저장소의 primary 토큰은 파랑이 아니다. 색 이름 대신 굵기로
  // 가리켜 테마가 바뀌어도 문구가 거짓이 되지 않게 한다.
  흐름: '회차마다 낙찰된 사정률입니다. 굵은 선이 내 값입니다.',
  '그날 하한': '가로 0은 그날 하한입니다. 낙찰값은 늘 그 바로 위입니다.',
  업체: '이 기관 회차에 참여한 업체와 그 업체가 선 자리입니다.'
};

const PENDING_REASON: Record<Exclude<DecisionView, '흐름'>, string> = {
  비교집단: '낙찰률 분포 계약(EAT-38)이 붙으면 호가창이 보입니다.',
  '그날 하한': '회차별 하한 자리 계약이 붙으면 이 탭이 보입니다.',
  업체: '회차별 명단 계약이 붙으면 참여 업체가 보입니다.'
};

const HISTORY_PENDING_REASON: Record<Exclude<HistoryState['state'], 'ready'>, string> = {
  'no-organization': '이 공고의 구매기관이 아직 정규화되지 않았습니다',
  unavailable: '회차 이력을 지금 불러오지 못했습니다'
};

function PendingBody({ reason }: { readonly reason: string }) {
  return (
    <p className='flex items-baseline gap-2 text-[15px] font-medium text-muted-foreground'>
      <span className='text-[13px] font-semibold whitespace-nowrap'>수집 전</span>
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

function FlowLegend() {
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

function FlowBody({ history }: { readonly history: HistoryState }) {
  if (history.state !== 'ready') return <PendingBody reason={HISTORY_PENDING_REASON[history.state]} />;
  return <FlowChart presentation={history.presentation} />;
}

export function EvidenceTabs({
  auctionId,
  search,
  history
}: {
  readonly auctionId: string;
  readonly search: DecisionSearch;
  readonly history: HistoryState;
}) {
  const active = search.view;

  return (
    <div className='flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl bg-card p-4 shadow-xs'>
      <div className='flex min-w-0 flex-wrap items-center gap-1'>
        <nav aria-label='근거 보기' className='flex flex-wrap items-center gap-1'>
          {DECISION_VIEWS.map((view) => (
            <Link
              key={view}
              href={{ pathname: `/auctions/${auctionId}`, query: decisionViewQuery(search, view) }}
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
      <p className='text-[13px] font-medium text-muted-foreground'>{NOTE[active]}</p>
      {active === '흐름' ? <FlowBody history={history} /> : <PendingBody reason={PENDING_REASON[active]} />}
    </div>
  );
}
