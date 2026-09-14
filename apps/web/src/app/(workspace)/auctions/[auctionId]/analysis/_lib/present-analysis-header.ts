/** @module 책임: 공고 조회의 관측 사실을 새 상세 상단의 기관·일정·금액 표시로 바꾼다. */
import { Temporal } from '@eatbid/domain';
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

export type AnalysisHeaderView = {
  readonly organization: string;
  readonly title: string;
  readonly location: string;
  readonly item: string;
  readonly status: string;
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly details: readonly { readonly label: string; readonly value: string }[];
};
/** 표시만 그룹화한다. 금액의 정밀도를 잃는 Number 변환과 환산은 하지 않는다. */
function moneyText(value: AuctionV1Response['pricing']['baseAmount']): string {
  const [whole, fraction] = value.amount.split('.');
  const amount = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = fraction?.replace(/0+$/, '');
  return (
    amount +
    (decimals ? '.' + decimals : '') +
    (value.currency === 'KRW' ? '원' : ' ' + value.currency)
  );
}
function kst(value: string | null): string {
  if (!value) return '미확인';
  const date = Temporal.Instant.from(value).toZonedDateTimeISO('Asia/Seoul');
  return (
    date.toPlainDate().toString() +
    ' ' +
    String(date.hour).padStart(2, '0') +
    ':' +
    String(date.minute).padStart(2, '0')
  );
}
export function presentAnalysisHeader(auction: AuctionV1Response): AnalysisHeaderView {
  const status = { OPEN: '진행 중', CLOSED: '개찰 완료' }[auction.identity.status ?? ''];
  return {
    organization:
      auction.organization?.name ?? (auction.organization ? '기관명 미확인' : '구매기관 미확인'),
    title: auction.identity.title ?? '공고명 미확인',
    location:
      [auction.location?.sido?.label, auction.location?.sigungu?.label].filter(Boolean).join(' ') ||
      '공고지역 미확인',
    item: auction.classification?.itemLabel ?? '품목 미확인',
    status: status ?? '공고 상태 미확인',
    facts: [
      { label: '기초금액', value: moneyText(auction.pricing.baseAmount) },
      {
        label: '낙찰하한율',
        value: auction.terms?.floorRate ? auction.terms.floorRate.value + '%' : '미확인'
      },
      { label: '마감', value: kst(auction.schedule.deadlineAt) },
      { label: '개찰', value: kst(auction.schedule.openedAt) }
    ],
    details: [
      { label: '공고번호', value: auction.identity.displayBidNumber ?? '미확인' },
      { label: '공고일', value: kst(auction.schedule.announcedAt) },
      { label: '낙찰방식', value: auction.terms?.awardMethod?.label ?? '미확인' },
      {
        label: '예정가격',
        value: auction.pricing.plannedAmount ? moneyText(auction.pricing.plannedAmount) : '미확인'
      }
    ]
  };
}
