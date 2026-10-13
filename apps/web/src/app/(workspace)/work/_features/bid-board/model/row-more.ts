/**
 * @module 책임: 오늘 투찰 한 행의 더 보기(아침 갱신 설명, 맞춤 예비 순위, 전국 공식 나머지 자리)와 목록 공통 성적·기준 문장을 만든다.
 *
 * 행 칸(`present-bid-board.ts`)은 "지금 무엇을 넣을지"를, 이 모듈은 "왜 그 금액인지·얼마나 믿을지"를 소유한다. 잰 기간·계산 판·규칙
 * 판은 빼지 않고 쉬운 말로 옮긴다(AGENTS 7).
 */
import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { marketPickRecord, type MarketPickBar } from '@/entities/market-pick-record/market-pick-record';
import { amountLine, type AmountLine } from './amount-line';

type Confirmed = Extract<MyBidBoardV1Response, { regionPreference: 'confirmed' }>;
type MarketHead = Confirmed['marketPick'];

/** 맞춤 방법을 부르는 말이다. 행마다 다시 만들지 않게 목록에서 한 번 만든다. */
export interface MarketWords {
  /** "10월 맞춤" */
  readonly name: string;
  /** "7~9월 내 사업자 공고 164건" */
  readonly source: string;
}

export interface RowMore {
  /** 아침 갱신이 실린 응답에서만 있다. 켜졌으면 무엇을 보고 골랐는지, 꺼졌으면 언제 생기는지다. */
  readonly habit: { readonly text: string; readonly record: string } | null;
  readonly market: {
    readonly title: string;
    readonly single: AmountLine & { readonly note: string | null };
    readonly spares: readonly AmountLine[];
    readonly basis: string;
  } | null;
  /** 전국 공식 표가 1·2번 뒤로 더 낸 금액이다. */
  readonly ruleExtras: readonly AmountLine[];
  readonly band: string | null;
}

export const EMPTY_MORE: RowMore = { habit: null, market: null, ruleExtras: [], band: null };

export function moreOf(
  row: BidBoardRowWire,
  head: MarketHead,
  words: MarketWords,
  habit: RowMore['habit']
): RowMore {
  const market = row.market?.state === 'applicable' && head.state === 'picked' ? row.market : null;
  const rule = row.rule?.state === 'applicable' ? row.rule : null;
  const floor = row.floorRate?.value ?? null;
  const band = rule === null ? null : rule.band.maxBidCount === null
    ? `이 공고에는 참여 ${rule.band.minBidCount}곳 이상 공고용 전국 공식 금액을 썼어요`
    : `이 공고에는 참여 ${rule.band.minBidCount}~${rule.band.maxBidCount}곳 공고용 전국 공식 금액을 썼어요`;
  return {
    habit,
    market: market === null ? null : {
      title: `${words.name} 더 보기`,
      single: {
        ...amountLine('한 곳만 넣을 때', market.single, floor),
        note: market.single.amount.amount === market.positions[0]!.amount.amount ? '이번 달은 1번과 같은 금액' : null
      },
      spares: market.spares.map((spare) => amountLine(`예비 ${spare.order}순위`, spare, floor)),
      basis: `${words.source}으로 고른 사정률이에요`
    },
    ruleExtras: rule?.positions.slice(2).map((position) => amountLine(`전국 공식 ${position.order}번`, position, floor)) ?? [],
    band
  };
}

export interface BoardRecord {
  readonly heading: string;
  readonly basis: string;
  readonly bars: readonly MarketPickBar[];
}

/** 더 보기 안의 성적 막대다. 공고마다 같은 값이라 한 번 만들어 행마다 그린다. 잰 기간과 계산 판을 함께 단다(AGENTS 7). */
export function recordOf(head: MarketHead, words: MarketWords): BoardRecord {
  const record = marketPickRecord(head.evidence, { version: head.version, mineLabel: words.name });
  return {
    heading: `성적 · 지난 공고 ${record.rounds.toLocaleString('ko-KR')}건`,
    basis: `${record.period} 공고에 1번·2번을 넣었다고 치고 센 낙찰 수예요(예정가격 추첨 평균 · 계산 ${head.version}).`,
    bars: record.bars
  };
}

/** 전국 공식 금액의 규칙 판·학습·검증 기간이다(AGENTS 7). */
export function ruleBasisText(rule: Confirmed['rule']): string {
  return `전국 공식 ${rule.version} 규칙 · ${rule.trainedThrough}까지 배우고 ${rule.validatedFrom}~${rule.validatedThrough}로 검증했어요.`;
}
