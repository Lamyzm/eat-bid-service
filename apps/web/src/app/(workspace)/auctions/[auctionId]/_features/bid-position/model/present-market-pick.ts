/**
 * @module 책임: 내 사업자 맞춤 금액(매달 다시 고르기) 응답을 이번 달 금액·계산 근거·비교 성적 문장으로 바꾸는 표시 모델을 소유한다.
 *
 * 전국 규칙 표시(`present-bid-position.ts`)와 나눈 이유는 근거의 모양이 달라서다. 전국 규칙은 참여 대역별 검증 낙찰률을, 이 금액은
 * 요청자 사업자가 넣은 공고로 매달 다시 고른 배수와 기간별 비교 성적을 말한다. 고른 창 안의 기대값은 고를 때 본 회차라 높게
 * 나오므로 보이지 않고, 다음 달을 고르기 전 자료로만 맞힌 걸어가기 성적을 근거로 낸다(ADR 0062). 창의 공고 수를 함께 보이는
 * 이유는 늦게 들어온 개찰 결과로 같은 달 안에서도 금액이 바뀔 수 있어서다 — 달 초 고정은 수집 시각이 서버가 읽지 못하는
 * ingest에만 있어 하지 않았다.
 */
import type { AuctionBidPositionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { marketPickRecord, type MarketPickRecord } from '@/entities/market-pick-record/market-pick-record';

type MarketPick = AuctionBidPositionV1Response['marketPick'];
type Applicable = Extract<MarketPick['result'], { state: 'applicable' }>;
type Reason = Extract<MarketPick['result'], { state: 'not-applicable' }>['reasons'][number];

export type MarketPickRow = {
  readonly label: string;
  readonly amount: string;
  readonly baseRelative: string;
};

export type MarketPickView =
  | { readonly kind: 'not-applicable'; readonly title: string; readonly reason: string }
  | {
      readonly kind: 'applicable';
      readonly title: string;
      readonly basis: string;
      readonly rows: readonly MarketPickRow[];
      readonly single: MarketPickRow | null;
      readonly pairNote: string | null;
      readonly record: MarketPickRecord;
    };

const GROUPING = /\B(?=(\d{3})+(?!\d))/g;

function wonText(amount: string): string {
  const [whole] = amount.split('.');
  return whole.replace(GROUPING, ',') + '원';
}

function monthNumber(month: string): number {
  return Number(month.slice(5, 7));
}

function yearMonthText(month: string): string {
  return `${month.slice(0, 4)}년 ${monthNumber(month)}월`;
}

/** 창의 마지막 달 다음 달이 금액을 쓰는 달이다. 12월 다음은 1월이다. */
function usingMonth(throughMonth: string): number {
  const month = monthNumber(throughMonth);
  return month === 12 ? 1 : month + 1;
}

function monthSpan(from: string, through: string): string {
  return from.slice(0, 4) === through.slice(0, 4)
    ? `${monthNumber(from)}~${monthNumber(through)}월`
    : `${yearMonthText(from)}~${yearMonthText(through)}`;
}

function rowOf(label: string, position: Applicable['single']): MarketPickRow {
  return {
    label,
    amount: wonText(position.amount.amount),
    baseRelative: `기초금액 대비 ${position.baseRelativeRate.value}%`
  };
}

function reasonText(reasons: readonly Reason[], marketRounds: number | null, minimumRounds: number): string {
  const text: Record<Reason, string> = {
    'floor-rate-unobserved': '낙찰하한율을 아직 확인하지 못했어요.',
    'floor-rate-outside-market-pick': '맞춤 금액은 하한율 90% 공고에서만 검증했어요.',
    'no-linked-business': '내 사업자에 등록한 업체가 개찰 기록에서 아직 확인되지 않았어요.',
    'market-rounds-below-minimum':
      `최근 석 달 내 사업자가 넣은 공고가 ${(marketRounds ?? 0).toLocaleString('ko-KR')}건이라 ` +
      `이번 달 금액을 고르지 않았어요(${minimumRounds.toLocaleString('ko-KR')}건 이상 필요).`,
    'market-data-unavailable': '지금은 맞춤 금액을 계산하지 못했어요. 잠시 뒤 새로고침해 주세요.'
  };
  return reasons.map((reason) => text[reason]).join(' ');
}

export function presentMarketPick(pick: MarketPick): MarketPickView {
  const title = `${usingMonth(pick.window.throughMonth)}월 내 사업자 맞춤 금액`;
  const { result } = pick;
  if (result.state === 'not-applicable') {
    return {
      kind: 'not-applicable',
      title,
      reason: reasonText(result.reasons, result.marketRounds, pick.minimumRounds)
    };
  }
  return {
    kind: 'applicable',
    title,
    basis:
      `${monthSpan(pick.window.fromMonth, pick.window.throughMonth)} 내 사업자가 넣은 하한율 90% 공고 ` +
      `${result.marketRounds.toLocaleString('ko-KR')}건에서, 다른 업체 금액 사이 빈틈 가운데 예정가격이 자주 떨어지는 ` +
      `자리를 골랐어요. 매달 다시 고르고, 늦게 들어온 개찰 결과가 더해지면 건수와 금액이 바뀔 수 있어요.`,
    rows: result.positions.map((position) => rowOf(`${position.order}번 사업자`, position)),
    single: singleRow(result),
    pairNote:
      result.positions.length === 1 ? '두 번째 사업자를 등록하면 2번 금액이 같이 나와요.' : null,
    record: marketPickRecord(result.evidence, { version: pick.version, mineLabel: '이 방법' })
  };
}

/**
 * 사업자가 하나면 두 장 금액이 곧 한 장 금액이라 따로 보이지 않는다. 두 장의 1번과 같은 달도 있는데, 그때 같은 금액을 다른 줄로
 * 말없이 보이면 둘이 다른 값으로 읽히므로 같다고 적는다.
 */
function singleRow(result: Applicable): MarketPickRow | null {
  if (result.positions.length < 2) return null;
  const row = rowOf('한 곳만 넣을 때', result.single);
  return result.single.amount.amount === result.positions[0]!.amount.amount
    ? { ...row, baseRelative: `${row.baseRelative} · 이번 달은 1번과 같은 금액` }
    : row;
}
