/** @module 책임: 전역 오른쪽 패널이 여는 현재 공고 상세 — 본문 요약이 줄인 일정·참여·미확인 항목과 이 기관의 발주 주기를 관측 그대로 나열한다. */
import type { OrgCadencePresentation } from '../_model/org-cadence';
import type { DecisionPresentation } from '../_model/present-decision';

type FactRow = { readonly label: string; readonly value: string; readonly tail?: string | null };

function auctionRows(decision: DecisionPresentation): readonly FactRow[] {
  const { participation } = decision;
  // 참여 꼬리는 하루 전 관측이 있으면 증감, 없으면 관측 시각이다. 관측 시각 없는 참여 수는 추정으로
  // 읽히므로 둘 다 없을 때(참여 미확인)만 꼬리를 비운다.
  const participationTail = participation.deltaText ?? (participation.observedAtText ? `${participation.observedAtText} 관측` : null);
  return [
    { label: '공고 지역', value: decision.locationText },
    { label: '품목', value: decision.itemLabelText },
    { label: '기초금액', value: `${decision.baseAmount.text}원` },
    { label: '하한율', value: decision.floorRateText },
    { label: '공고 (KST)', value: decision.banner.announcedAt },
    { label: '마감 (KST)', value: decision.banner.deadlineAt },
    { label: '개찰 (KST)', value: decision.banner.openedAt },
    { label: '참여', value: participation.countText, tail: participationTail },
    // 정정 횟수와 납품 기간은 아직 소스 필드가 정규화·계약에 없다. 자리를 비우면 "정정 없음"으로
    // 읽히므로 지어내지 않고 미확인이라 적는다(AGENTS 3).
    { label: '정정', value: '미확인' },
    { label: '납품', value: '미확인' }
  ];
}

// 기관 이력에서 센 값이다. 공고 사실과 계보가 다르므로 같은 목록에 섞지 않고 표본 수를 꼬리로 붙인다(AGENTS 7).
function cadenceRows(cadence: OrgCadencePresentation): readonly FactRow[] {
  return [
    { label: '누적 회차', value: cadence.attemptCountText },
    ...(cadence.cadenceText === null
      ? []
      : [{ label: '발주 주기', value: cadence.cadenceText, tail: cadence.cadenceBasisText }]),
    ...(cadence.lastAnnouncementText === null
      ? []
      : [{ label: '지난 공고', value: cadence.lastAnnouncementText }])
  ];
}

function FactList({ rows }: { readonly rows: readonly FactRow[] }) {
  return (
    <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm'>
      {rows.map(({ label, value, tail }) => (
        <div key={label} className='contents'>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd className='m-0 text-right break-keep wrap-anywhere tabular-nums'>
            {value}
            {tail ? <span className='ml-1 text-[13px] font-semibold text-muted-foreground'>{tail}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CurrentAuctionFacts({
  decision,
  cadence
}: {
  readonly decision: DecisionPresentation;
  readonly cadence: OrgCadencePresentation;
}) {
  return (
    <section aria-label='현재 공고 사실' className='grid gap-3 border-b px-4 py-3'>
      <h3 className='text-sm font-semibold break-keep wrap-anywhere'>{decision.identity.title}</h3>
      <FactList rows={auctionRows(decision)} />
      <div className='grid gap-2 border-t pt-3'>
        <h4 className='text-[13px] font-semibold text-muted-foreground'>이 기관의 회차 이력</h4>
        <FactList rows={cadenceRows(cadence)} />
      </div>
    </section>
  );
}
