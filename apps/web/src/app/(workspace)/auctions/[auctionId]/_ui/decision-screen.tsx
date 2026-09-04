/** @module 책임: 결정 화면 v2 셸을 조립한다. 계약이 있는 영역만 채우고 없는 영역은 수집 전 카드로 둔다. */
import type { DecisionSearch } from '../_lib/decision-search-params';
import type { HistoryPresentation } from '../_model/attempt-history';
import type { DecisionPageData } from '../_model/load-auction-page';
import type { DecisionPresentation } from '../_model/present-decision';
import { BidRail } from './bid-rail';
import { BidRateProvider } from './bid-rate-context';
import { DecisionBanner } from './decision-banner';
import { DecisionFrame } from './decision-frame';
import { DecisionHeader } from './decision-header';
import { EvidenceTabs } from './evidence-tabs';
import { HistoryTable } from './history-table';
import { PendingCard } from './pending-card';
import { RehearsalPanel } from './rehearsal-panel';

type HistoryState = DecisionPageData['history'];

// 이력을 못 부른 이유를 화면이 그대로 말한다. 두 경우는 사용자가 할 일이 다르다. 기관 미정규화는
// 수집이 더 필요하다는 뜻이고 조회 실패는 다시 열어보면 될 수 있다.
const PENDING_REASON: Record<Exclude<HistoryState['state'], 'ready'>, string> = {
  'no-organization': '이 공고의 구매기관이 아직 정규화되지 않았습니다',
  unavailable: '회차 이력을 지금 불러오지 못했습니다'
};

function HistoryCard({ presentation }: { readonly presentation: HistoryPresentation }) {
  return (
    <div className='overflow-hidden rounded-xl bg-card shadow-xs'>
      <div className='flex items-baseline gap-2 px-4 pt-4'>
        <span className='text-xl font-bold'>과거 회차</span>
        <span className='text-[13px] font-semibold text-muted-foreground'>{presentation.sampleCount}회 · 최근 12회 표시</span>
      </div>
      {/* 디자인 원문은 "파란 열"이지만 이 저장소의 primary 토큰은 파랑이 아니다. 색 이름 대신 자리로
          가리켜 테마가 바뀌어도 문구가 거짓이 되지 않게 한다. */}
      <p className='px-4 py-2 text-[13px] font-medium text-muted-foreground'>
        <span className='text-primary'>마지막 열</span>은 지금 값을 그때 냈다고 치고 계산한 것입니다. 실제로 낸 적은 없습니다.
      </p>
      <HistoryTable rows={presentation.rows} />
    </div>
  );
}

export function DecisionScreen({
  decision,
  search,
  history
}: {
  readonly decision: DecisionPresentation;
  readonly search: DecisionSearch;
  readonly history: HistoryState;
}) {
  // 선택 품목이 아닌 회차는 경쟁 구조가 달라 같은 분모에 넣으면 거짓이 된다. "이 값이면"은 선택
  // 품목 회차만 센다.
  const selectedRows = history.state === 'ready' ? history.presentation.rows.filter((row) => row.isSelectedItem) : [];

  return (
    <BidRateProvider initialRate='90.000'>
      <DecisionFrame
        header={<DecisionHeader decision={decision} search={search} />}
        banner={<DecisionBanner decision={decision} />}
        evidence={
          <div className='grid gap-4'>
            <EvidenceTabs auctionId={decision.identity.auctionId} search={search} history={history} />
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
        history={
          history.state === 'ready' ? (
            <HistoryCard presentation={history.presentation} />
          ) : (
            <PendingCard title='과거 회차' reason={PENDING_REASON[history.state]} />
          )
        }
        rail={<BidRail decision={decision} rehearsal={history.state === 'ready' ? <RehearsalPanel rows={selectedRows} /> : null} />}
      />
    </BidRateProvider>
  );
}
