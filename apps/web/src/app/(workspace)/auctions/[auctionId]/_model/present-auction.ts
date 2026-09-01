/** @module 책임: 공고 wire 값을 정밀도 손실 없이 화면 전용 표시 모델로 변환한다. */
import type { AuctionV1Response } from '@eatbid/contracts/api/v1/auctions';

type MoneyPresentation = {
  readonly raw: string | null;
  readonly text: string;
};

export type AuctionPresentation = {
  readonly identity: AuctionV1Response['identity'];
  readonly schedule: {
    readonly announcedAt: string;
    readonly deadlineAt: string;
    readonly openedAt: string;
  };
  readonly baseAmount: MoneyPresentation;
  readonly plannedAmount: MoneyPresentation;
  readonly provenance: AuctionV1Response['provenance'];
};

function formatExactMoney(money: AuctionV1Response['pricing']['baseAmount']): MoneyPresentation {
  const [whole, fraction] = money.amount.split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return {
    raw: money.amount,
    text: `${groupedWhole}.${fraction} ${money.currency}`
  };
}

/** 공개 계약을 표시 전용 문자열로 바꾸되 exact 값과 provenance 원문을 보존한다. */
export function presentAuction(response: AuctionV1Response): AuctionPresentation {
  return {
    identity: response.identity,
    schedule: {
      announcedAt: response.schedule.announcedAt,
      deadlineAt: response.schedule.deadlineAt ?? '미확인',
      openedAt: response.schedule.openedAt ?? '미확인'
    },
    baseAmount: formatExactMoney(response.pricing.baseAmount),
    plannedAmount: response.pricing.plannedAmount
      ? formatExactMoney(response.pricing.plannedAmount)
      : { raw: null, text: '미확인' },
    provenance: response.provenance
  };
}
