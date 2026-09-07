/** @module 책임: URL `expand` 값에 해당하는 크게 보기 본문 하나를 고르고 제목·부제·안내문을 붙여 모달 셸에 넣는다. 데이터가 없는 본문은 모달에서도 수집 전임을 그대로 말한다. */
import type { DecisionSearch, DecisionExpand } from '../../_lib/decision-search-params';
import type { DecisionPageData } from '../../_model/load-auction-page';
import type { DecisionPresentation } from '../../_model/present-decision';
import { sampleSizeText } from '../../_model/sample-size';
import { DistributionHeatmap } from '../distribution-heatmap';
import {
  DISTRIBUTION_PENDING_REASON,
  EXPAND_PENDING_REASON,
  HISTORY_PENDING_REASON,
  PendingBody
} from '../evidence-tabs';
// 범례는 계열 토글이라 client 모듈이 소유한다(EAT-89). 모달과 탭이 같은 토글 상태를 공유한다.
import { FlowLegend } from '../flow-legend';
import { ExpandDialog } from './expand-dialog';
import { FlowExpand } from './flow-expand';
import { HistoryExpand } from './history-expand';
import { loadedRangeText } from './history-range';

type HistoryState = DecisionPageData['history'];
type DistributionState = DecisionPageData['distribution'];

type ExpandContent = {
  readonly title: string;
  readonly subtitle: string | null;
  readonly note: string | null;
  readonly body: React.ReactNode;
};

// 시안 제목을 따르되 "탈락"은 소스 판정 코드에 없는 판정어라 쓰지 않는다(verdict-vocabulary.ts).
const TITLE: Record<DecisionExpand, string> = {
  '과거 회차': '과거 회차',
  비교집단: '비교집단 · 달마다 어디에 몰렸나',
  흐름: '회차별 흐름',
  '그날 하한': '그날 하한 위 자리',
  업체: '참여 업체'
};

function historyContent(history: HistoryState, decision: DecisionPresentation, search: DecisionSearch): ExpandContent {
  if (history.state !== 'ready') {
    return { title: TITLE['과거 회차'], subtitle: null, note: null, body: <PendingBody reason={HISTORY_PENDING_REASON[history.state]} /> };
  }
  const { presentation, loadFailed } = history.expanded;
  const range = loadedRangeText(presentation.rows);
  return {
    title: TITLE['과거 회차'],
    subtitle: [`${presentation.sampleCount.toLocaleString('ko-KR')}회`, range].filter((part) => part !== null).join(' · '),
    // 마지막 두 열은 원본 판정이 아니라 내 값과의 비교다. 표 안쪽 카드와 같은 문장으로 말한다.
    note: '마지막 두 열은 지금 값을 그때 냈다고 치고 계산한 것입니다. 실제로 낸 적은 없습니다.',
    body: (
      <HistoryExpand
        auctionId={decision.identity.auctionId}
        search={search}
        presentation={presentation}
        loadFailed={loadFailed}
        myRate={search.myRate}
      />
    )
  };
}

function cohortContent(distribution: DistributionState, search: DecisionSearch): ExpandContent {
  const title = TITLE.비교집단;
  if (distribution.state !== 'ready') {
    const reason = distribution.state === 'locked' ? distribution.reason : 'unavailable';
    return { title, subtitle: null, note: null, body: <PendingBody reason={DISTRIBUTION_PENDING_REASON[reason]} /> };
  }
  const { presentation, response } = distribution;
  const subtitle = [search.scope, '품목 전체', `하한율 ${presentation.meta.floorRate.value}`, search.period, sampleSizeText(presentation.sampleCount)].join(' · ');
  if (presentation.ladder === null) {
    return { title, subtitle, note: null, body: <PendingBody label='미확인' reason={presentation.reason ?? ''} /> };
  }
  return {
    title,
    subtitle,
    note: '진할수록 그 달에 그 값이 많았습니다. 오른쪽 끝은 그 달 표본입니다.',
    body: <DistributionHeatmap months={response.months} ladder={presentation.ladder} />
  };
}

function flowContent(history: HistoryState, search: DecisionSearch): ExpandContent {
  const title = TITLE.흐름;
  if (history.state !== 'ready') {
    return { title, subtitle: null, note: null, body: <PendingBody reason={HISTORY_PENDING_REASON[history.state]} /> };
  }
  const { presentation } = history;
  return {
    title,
    subtitle: `${presentation.selectedItem?.label ?? '품목 전체'} · 표본 ${presentation.sampleCount.toLocaleString('ko-KR')}회`,
    note: '회차마다 낙찰된 사정률입니다. 굵은 선이 내 값이고 아래 막대는 그 회차의 명단 수입니다.',
    body: (
      <div className='grid min-w-0 gap-3'>
        <div className='flex flex-wrap items-center'>
          <FlowLegend />
        </div>
        <FlowExpand presentation={presentation} myRate={search.myRate} />
      </div>
    )
  };
}

function pendingContent(expand: '그날 하한' | '업체'): ExpandContent {
  // 계약이 없는 본문은 모달을 열어도 무엇이 올 자리인지와 수집 전임만 말한다. 빈 모달은 고장으로 읽힌다.
  return { title: TITLE[expand], subtitle: null, note: null, body: <PendingBody reason={EXPAND_PENDING_REASON[expand]} /> };
}

function contentOf(
  expand: DecisionExpand,
  input: {
    readonly decision: DecisionPresentation;
    readonly search: DecisionSearch;
    readonly history: HistoryState;
    readonly distribution: DistributionState;
  }
): ExpandContent {
  switch (expand) {
    case '과거 회차':
      return historyContent(input.history, input.decision, input.search);
    case '비교집단':
      return cohortContent(input.distribution, input.search);
    case '흐름':
      return flowContent(input.history, input.search);
    case '그날 하한':
    case '업체':
      return pendingContent(expand);
  }
}

/** 닫힌 상태(`expand` 없음)에서는 아무것도 그리지 않는다. 열림의 진실은 주소다. */
export function DecisionExpand({
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
  if (search.expand === null) return null;
  const content = contentOf(search.expand, { decision, search, history, distribution });
  return (
    // 본문이 바뀌면 셸의 로컬 닫힘 상태도 버려야 하므로 key로 다시 만든다.
    <ExpandDialog
      key={search.expand}
      auctionId={decision.identity.auctionId}
      search={search}
      title={content.title}
      subtitle={content.subtitle}
      note={content.note}
    >
      {content.body}
    </ExpandDialog>
  );
}
