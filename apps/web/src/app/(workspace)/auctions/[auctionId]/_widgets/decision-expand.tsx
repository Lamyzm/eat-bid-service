/** @module 책임: 모달로 여는 유일한 확대 본문인 낙찰값 분포 히트맵의 제목·부제·안내문을 만들고 모달 셸에 넣는다. 재료가 없으면 모달에서도 수집 전임을 그대로 말한다. */
import type { DecisionSearch } from '../_lib/decision-search-params';
import type { DecisionPageData } from '../_lib/load-auction-page';
import type { DecisionPresentation } from '../_lib/present-decision';
import { sampleSizeText } from '../_features/distribution/model/sample-size';
import { DistributionHeatmap } from '../_features/distribution/ui/distribution-heatmap';
import { DISTRIBUTION_PENDING_REASON, PendingBody } from './evidence-tabs';
import { ExpandDialog } from './expand-dialog';

type DistributionState = DecisionPageData['distribution'];

// 시안 제목을 따르되 "탈락"은 소스 판정 코드에 없는 판정어라 쓰지 않는다(verdict-vocabulary.ts).
const TITLE = '낙찰값 분포 · 달마다 어디에 몰렸나';

function cohortContent(distribution: DistributionState, search: DecisionSearch) {
  if (distribution.state !== 'ready') {
    const reason = distribution.state === 'locked' ? distribution.reason : 'unavailable';
    return { subtitle: null, note: null, body: <PendingBody reason={DISTRIBUTION_PENDING_REASON[reason]} /> };
  }
  const { presentation, response } = distribution;
  const subtitle = [search.scope, '품목 전체', `하한율 ${presentation.meta.floorRate.value}`, search.period, sampleSizeText(presentation.sampleCount)].join(' · ');
  if (presentation.ladder === null) {
    return { subtitle, note: null, body: <PendingBody label='미확인' reason={presentation.reason ?? ''} /> };
  }
  return {
    subtitle,
    note: '진할수록 그 달에 그 값이 많았습니다. 오른쪽 끝은 그 달 표본입니다.',
    body: <DistributionHeatmap months={response.months} ladder={presentation.ladder} />
  };
}

/**
 * 닫힌 상태(`expand` 없음)에서는 아무것도 그리지 않는다. 열림의 진실은 주소다. 흐름과 과거 회차 확대는
 * 같은 본문의 집중 모드라 `DecisionFrame`이 소유한다 — 모달로 복제하면 선택·범위·오른쪽 기록이 갈라진다.
 */
export function DecisionExpand({
  decision,
  search,
  distribution
}: {
  readonly decision: DecisionPresentation;
  readonly search: DecisionSearch;
  readonly distribution: DistributionState;
}) {
  if (search.expand !== '비교집단') return null;
  const content = cohortContent(distribution, search);
  return (
    <ExpandDialog
      auctionId={decision.identity.auctionId}
      search={search}
      title={TITLE}
      subtitle={content.subtitle}
      note={content.note}
    >
      {content.body}
    </ExpandDialog>
  );
}
