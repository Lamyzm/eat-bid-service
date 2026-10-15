/**
 * @module 책임: "몰린 칸을 따라 넣으면 맞을까?"의 숫자(견줄 실제 한 달, 그 달 몰림이 추첨만으로 얼마나 드문지, 지난달·같은 달
 * 따라가기 적중과 섞은 값)와 문장을 만든다.
 *
 * 몰림 숫자를 보일 때는 늘 섞은 값을 옆에 둔다(PDR-0009 결정 3). 난수는 씨앗을 고정해 같은 화면이 같은 숫자를 말하게 한다.
 */
import type { FloorPeriod } from '@/entities/floor-line/floor-period';
import { drawFloors, seededRandom } from '@/app/(workspace)/floor/_lib/floor-rule';
import {
  hottestBand,
  MIN_MONTH_COUNT,
  monthBands,
  previousMonthFollowRate,
  sameMonthFollowRate,
  shuffled,
  shuffledFloors
} from '@/app/(workspace)/floor/_lib/floor-stats';
import { monthNumber, tenthsText } from '@/entities/floor-line/floor-units';
import type { FloorPoint } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';

/** 견줄 한 달은 공고가 이만큼은 있어야 점 그림이 모양을 갖는다. */
const SAMPLE_MIN_COUNT = 30;
const RARITY_TRIALS = 1_000;
const SAME_MONTH_SHUFFLES = 10;
const PREVIOUS_MONTH_SHUFFLES = 60;
/** 지난달 따라가기는 이어진 달이 이만큼은 있어야 말한다. 몇 달로는 우연과 가를 수 없다. */
const MIN_FOLLOW_MONTHS = 6;
const MIN_SAME_MONTH_TRIES = 50;
/** 따라간 적중과 섞은 적중이 이만큼(2%p) 안이면 같다고 말한다. 한 지역 수천 번 시험의 표준오차가 1%p 안팎이다. */
const CLOSE_RATIO = 0.02;

export interface ChanceView {
  /** 실제와 견줄 가장 최근의 끝난 달이다. */
  readonly sample: { readonly month: string; readonly name: string; readonly values: readonly number[] } | null;
  readonly lede: string;
  readonly rarity: string | null;
  readonly lines: readonly { readonly text: string; readonly strong: string | null; readonly rest: string; readonly big: boolean }[];
}

function rarityText(values: readonly number[], quantiles: readonly number[], width: number): string {
  const real = hottestBand(values, width);
  const random = seededRandom(4242);
  let atLeast = 0;
  for (let trial = 0; trial < RARITY_TRIALS; trial += 1) {
    if (hottestBand(drawFloors(quantiles, values.length, random), width).inside >= real.inside) atLeast += 1;
  }
  const share = Math.round((100 * real.inside) / values.length);
  return atLeast <= 10
    ? `이 달처럼 한 칸에 ${share}%가 몰리는 건 추첨만으로는 1,000번 굴려 ${atLeast > 0 ? `${atLeast}번` : '한 번도 안'} 나오는 드문 달이에요. 다만 전국에서 달 중간까지 이렇게 몰린 45번을 모아 보면, 그 달 남은 공고가 그 칸에 더 들어가지는 않았어요(10.6%, 추첨대로면 10.6%).`
    : `추첨만 돌려도 이 달처럼 한 칸에 ${share}%가 몰리는 달은 1,000번 중 ${atLeast}번 나와요. 드물지 않은 흔들림이에요.`;
}

export function presentChance(points: readonly FloorPoint[], period: FloorPeriod, quantiles: readonly number[], width: number): ChanceView {
  const finished = points.filter((point) => point.month !== period.currentMonth);
  const months = monthBands(finished, width);
  const latest = months.toReversed().find((band) => band.count >= SAMPLE_MIN_COUNT);
  const sample =
    latest === undefined
      ? null
      : {
          month: latest.month,
          name: `${monthNumber(latest.month)}월`,
          values: finished.filter((point) => point.month === latest.month).map((point) => point.floor)
        };
  const lede =
    sample === null
      ? '공고가 30건 넘은 달이 없어 견줄 수 없어요.'
      : `위는 실제 ${sample.name} ${sample.values.length}건, 아래는 같은 수만큼 추첨 방식대로 컴퓨터로 굴려 본 한 달이에요. 색칠한 띠는 그 한 달에 가장 많이 몰린 칸이에요. 추첨만 굴려도 몰린 칸은 생겨요. 이 달이 그보다 얼마나 더 몰렸는지와, 몰린 칸을 다음 공고에 대 본 결과는 아래에 적었어요.`;
  const lines: ChanceView['lines'][number][] = [];
  const previous = previousMonthFollowRate(finished, width);
  if (previous.months >= MIN_FOLLOW_MONTHS && previous.tries > 0) {
    const random = seededRandom(5);
    const fullMonths = months.filter((band) => band.count >= MIN_MONTH_COUNT).length;
    let sum = 0;
    for (let trial = 0; trial < PREVIOUS_MONTH_SHUFFLES; trial += 1) {
      const result = previousMonthFollowRate(finished, width, shuffled([...Array(fullMonths).keys()], random));
      sum += result.hits / result.tries;
    }
    lines.push({
      text: '지난달 가장 많이 몰린 칸을 다음 달 공고에 대 보면, 하한선이 그 칸에 든 건 ',
      strong: tenthsText(previous.hits / previous.tries),
      rest: `이었어요. 다른 달의 몰린 칸을 대 봐도 ${tenthsText(sum / PREVIOUS_MONTH_SHUFFLES)}이에요.`,
      big: true
    });
  }
  const same = sameMonthFollowRate(finished, width);
  if (same.tries >= MIN_SAME_MONTH_TRIES) {
    const random = seededRandom(99);
    let sum = 0;
    for (let trial = 0; trial < SAME_MONTH_SHUFFLES; trial += 1) {
      const result = sameMonthFollowRate(shuffledFloors(finished, random), width);
      sum += result.tries === 0 ? 0 : result.hits / result.tries;
    }
    lines.push({
      text: `같은 달에 먼저 개찰된 공고들이 가장 많이 몰린 칸을 그 달 남은 공고에 대 봐도 하한선이 그 칸에 든 건 ${tenthsText(same.hits / same.tries)}이었어요. 자주 나오는 다른 칸을 대 봐도 ${tenthsText(sum / SAME_MONTH_SHUFFLES)}이에요.`,
      strong: null,
      rest: '',
      big: false
    });
    // 결론은 이 지역 숫자가 섞은 값과 같을 때만 그대로 말한다. 다르면 전국 검정을 근거로 들고 한 지역의 몇 달로는 가를 수 없다고 적는다.
    const close = Math.abs(same.hits / same.tries - sum / SAME_MONTH_SHUFFLES) < CLOSE_RATIO;
    lines.push({
      text: close
        ? '몰린 칸은 추첨이 만드는 흔들림이라 따라가도 맞는 횟수가 늘지 않았어요. 그래서 이 화면은 다음 달이나 남은 공고를 맞히지 않고, 어디쯤 나오는지만 보여 줘요.'
        : '이 지역은 따라간 쪽과 섞은 쪽이 조금 달라요. 다만 공고 많은 시군구 25곳을 모아 보면 따라가도 맞는 횟수가 늘지 않았어요(10.1%, 섞으면 10.0%). 그래서 이 화면은 다음 달이나 남은 공고를 맞히지 않고, 어디쯤 나오는지만 보여 줘요.',
      strong: null,
      rest: '',
      big: false
    });
  }
  return { sample, lede, rarity: sample === null ? null : rarityText(sample.values, quantiles, width), lines };
}
