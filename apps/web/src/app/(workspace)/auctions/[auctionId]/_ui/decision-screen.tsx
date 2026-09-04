/** @module 책임: 결정 화면 v2 셸을 조립한다. 계약이 있는 영역만 채우고 없는 영역은 수집 전 카드로 둔다. */
import type { DecisionSearch } from '../_lib/decision-search-params';
import type { DecisionPageData } from '../_model/load-auction-page';
import type { DecisionPresentation } from '../_model/present-decision';
import { BidRail } from './bid-rail';
import { DecisionBanner } from './decision-banner';
import { DecisionFrame } from './decision-frame';
import { DecisionHeader } from './decision-header';
import { PendingCard } from './pending-card';

// history는 EAT-37 Task 6(UI)에서 소비한다. 여기서는 아직 렌더링하지 않고 타입만 받아 page.tsx와의
// 계약을 먼저 맞춘다.
export function DecisionScreen({
  decision,
  search
}: {
  readonly decision: DecisionPresentation;
  readonly search: DecisionSearch;
  readonly history?: DecisionPageData['history'];
}) {
  return (
    <DecisionFrame
      header={<DecisionHeader decision={decision} search={search} />}
      banner={<DecisionBanner decision={decision} />}
      evidence={
        <div className='grid gap-4'>
          <PendingCard title='비교집단' reason='낙찰률 분포 계약(EAT-38)이 붙으면 호가창이 보입니다.' />
          <PendingCard title='흐름' reason='기관 회차 이력 계약(EAT-37)이 붙으면 회차별 낙찰률이 보입니다.' />
          <details className='rounded-xl bg-card p-4 shadow-xs'>
            <summary className='cursor-pointer text-[15px] font-semibold'>원문과 추적 정보</summary>
            <dl className='mt-3 grid gap-3 sm:grid-cols-2'>
              {[
                ['원천 시스템', decision.provenance.sourceSystem],
                ['관측 ID', decision.provenance.observationId],
                ['정규화 레코드 ID', decision.provenance.normalizedRecordId],
                ['내용 SHA-256', decision.provenance.contentSha256],
                ['공고 상태', decision.identity.status],
                ['리비전 ID', decision.identity.revisionId],
                ['외부 공고 ID', decision.identity.externalBidId],
                ['예정금액', decision.plannedAmount.text]
              ].map(([label, value]) => (
                <div key={label} className='grid gap-1'>
                  <dt className='text-[13px] font-semibold text-muted-foreground'>{label}</dt>
                  <dd className='min-w-0 text-[15px] font-medium break-all'>{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      }
      history={<PendingCard title='과거 회차' reason='기관 회차 이력 계약(EAT-37)이 붙으면 최근 12회가 보입니다.' />}
      rail={<BidRail decision={decision} />}
    />
  );
}
