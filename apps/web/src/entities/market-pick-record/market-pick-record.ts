/**
 * @module 책임: 맞춤 금액의 비교 성적(같은 공고에 네 방법을 대어 본 낙찰 수)을 막대 길이·순서·문장으로 바꾼다. 공고 상세의 추천
 * 투찰가 칸과 오늘 투찰의 더 보기가 같은 성적을 같은 계산으로 보여야 해서 화면 밖에 둔다.
 */
import type { AuctionBidPositionV1Response } from '@eatbid/contracts/api/v1/auctions';

import { decimalScale, scaledText, sumAtScale } from '@/shared/lib/decimal-sum';

type Applicable = Extract<AuctionBidPositionV1Response['marketPick']['result'], { state: 'applicable' }>;
export type MarketEvidenceEntry = Applicable['evidence'][number];

export type MarketPickBar = {
  readonly label: string;
  readonly value: string;
  /** 가장 큰 막대에 대한 길이 비율(백분율, 소수 한 자리)이다. */
  readonly widthPercent: string;
  readonly mine: boolean;
};

export type MarketPickRecord = {
  /** 성적을 잰 공고 수(기간 합)다. */
  readonly rounds: number;
  readonly title: string;
  readonly bars: readonly MarketPickBar[];
  readonly note: string;
};

const yearMonthText = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;

/**
 * 네 방법을 같은 공고에 대어 본 낙찰 수 막대다. 막대 길이는 가장 큰 값에 대한 비율이고, 값이 큰 순서로 세운다. 순서와 길이를
 * 화면이 다시 계산하지 않도록 여기서 정해 넘긴다. 금액 합은 소수 문자열을 정수 단위로 더해 오차를 만들지 않는다.
 */
export function marketPickRecord(
  evidence: readonly MarketEvidenceEntry[],
  options: { readonly version: string; readonly mineLabel: string }
): MarketPickRecord {
  const methods = [
    { field: 'expectedWins', label: options.mineLabel, mine: true },
    { field: 'ruleExpectedWins', label: '전국 공식', mine: false },
    { field: 'lotteryExpectedWins', label: '무작위 자리', mine: false },
    { field: 'currentExpectedWins', label: '그동안 낸 금액', mine: false }
  ] as const;
  const first = evidence[0]!;
  const last = evidence[evidence.length - 1]!;
  const rounds = evidence.reduce((total, entry) => total + entry.rounds, 0);
  const scale = decimalScale(evidence.flatMap((entry) => methods.map(({ field }) => entry[field])));
  const sums = methods.map((method) => ({
    ...method,
    units: sumAtScale(evidence.map((entry) => entry[method.field]), scale)
  })).toSorted((left, right) => (left.units === right.units ? 0 : left.units > right.units ? -1 : 1));
  const largest = sums[0]!.units;
  const permille = (units: bigint) =>
    largest === BigInt(0) ? BigInt(0) : (units * BigInt(2000) + largest) / (largest * BigInt(2));
  return {
    rounds,
    title:
      `같은 공고 ${rounds.toLocaleString('ko-KR')}건(${yearMonthText(first.from)}~${yearMonthText(last.through)})에 ` +
      `대어 본 낙찰 수 · 두 장, 예정가격 추첨 평균`,
    bars: sums.map(({ label, mine, units }) => {
      const width = permille(units);
      return {
        label,
        value: `${scaledText(units, scale)}건`,
        widthPercent: `${width / BigInt(10)}.${width % BigInt(10)}`,
        mine
      };
    }),
    note: `매달 앞선 석 달로만 금액을 골라 다음 달 공고에 대어 봤어요. 계산 판 ${options.version}.`
  };
}
