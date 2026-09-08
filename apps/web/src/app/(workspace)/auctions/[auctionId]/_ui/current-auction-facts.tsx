/** @module 책임: 전역 오른쪽 패널이 여는 현재 공고 상세 — 본문 요약이 줄인 일정·참여·미확인 항목과 이 기관의 발주 주기를 관측 그대로 나열한다. */
import { Fragment } from 'react';

import type { OrgCadencePresentation } from '../_model/org-cadence';
import type { DecisionPresentation } from '../_model/present-decision';

// 꼬리는 조각 목록이다. 좁은 dock에서 한 문자열로 두면 "09-07 대비"와 "+1"이 서로 다른 줄로 갈라져
// 날짜 없는 증감처럼 읽힌다. 조각 사이에서만 줄이 바뀌도록 각 조각을 끊기지 않는 단위로 넘긴다.
type FactRow = { readonly label: string; readonly value: string; readonly tail?: readonly string[] };

function auctionRows(decision: DecisionPresentation): readonly FactRow[] {
  const { participation } = decision;
  // 참여 꼬리는 "언제 본 값인가"를 먼저 말하고 비교 관측이 있을 때만 증감을 잇는다. 증감만 보이면 어느
  // 시점의 수가 얼마나 변한 것인지 알 수 없고, 두 날짜가 나란히 있어야 오래된 비교를 사용자가 알아본다.
  // 관측이 아예 없을 때(참여 미확인)만 꼬리를 비운다.
  const participationTail = [
    participation.observedAtText === null ? null : `${participation.observedAtText} 기준`,
    participation.deltaText
  ].filter((part): part is string => part !== null);
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
      : [
          {
            label: '발주 주기',
            value: cadence.cadenceText,
            tail: cadence.cadenceBasisText === null ? [] : [cadence.cadenceBasisText]
          }
        ]),
    ...(cadence.lastAnnouncementText === null
      ? []
      : [{ label: '지난 공고', value: cadence.lastAnnouncementText }])
  ];
}

function FactList({ rows }: { readonly rows: readonly FactRow[] }) {
  return (
    <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm'>
      {rows.map(({ label, value, tail = [] }) => (
        <div key={label} className='contents'>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd className='m-0 text-right break-keep wrap-anywhere tabular-nums'>
            {value}
            {tail.map((part, index) => (
              // 조각 사이의 공백만 줄바꿈 자리다. 조각 자체는 `nowrap`이라 "09-07 대비 +1"이 갈라지지 않고,
              // 폭 검사가 nowrap 넘침을 세므로 조각이 dock 폭을 넘기면 조용히 잘리지 않고 실패로 드러난다.
              <Fragment key={part}>
                {index === 0 ? ' ' : ' · '}
                <span className='text-[13px] font-semibold whitespace-nowrap text-muted-foreground'>{part}</span>
              </Fragment>
            ))}
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
