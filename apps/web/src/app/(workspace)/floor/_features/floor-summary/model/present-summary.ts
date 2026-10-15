/**
 * @module 책임: 고른 지역·기간의 하한선 점으로 화면 맨 위 요약(건수, 열 번 중 다섯 번 범위, 범위의 한계, 이번 달 개찰)을 만든다.
 *
 * 범위 문장 바로 뒤에 "이 안에 넣으면 된다는 뜻이 아니다"를 붙인다. 가운데 절반 범위만 보이면 그 안이 안전한 자리로 읽힌다
 * (2026-10-15 처음 보는 사장님 리뷰). 가운데값에 넣어도 절반은 하한 미달이라는 사실이 그 오독을 바로 막는다.
 */
import type { FloorPeriod } from '@/app/(workspace)/floor/_lib/floor-period';
import type { FloorData } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { quantileOf } from '@/app/(workspace)/floor/_lib/floor-stats';
import { countText, monthNumber, organizationLabel, per100MillionText, rateText } from '@/app/(workspace)/floor/_lib/floor-units';

/** 공고가 이보다 적으면 범위를 말하지 않는다. 몇 건의 사분위는 공고 하나만 바뀌어도 크게 흔들린다. */
const MIN_RANGE_COUNT = 8;

export interface FloorSummaryView {
  readonly headline: string;
  readonly range: { readonly lead: string; readonly strong: string; readonly rest: string } | null;
  readonly caution: string | null;
  readonly thisMonth: string;
}

export function presentSummary(data: FloorData, period: FloorPeriod): FloorSummaryView {
  const sorted = data.points.map((point) => point.floor).toSorted((left, right) => left - right);
  const headline = `${data.region.place} · ${period.label} 하한율 90% 공고 ${countText(sorted.length)}건`;
  const current = data.points.filter((point) => point.month === period.currentMonth);
  const monthName = `이번 달(${monthNumber(period.currentMonth)}월)`;
  const thisMonth =
    current.length === 0
      ? `${monthName}은 아직 개찰이 끝난 하한율 90% 공고가 없어요.`
      : `${monthName} 개찰이 끝난 하한율 90% 공고 ${countText(current.length)}건 · ${current
          .slice(-3)
          .toReversed()
          .map((point) => `${point.date.slice(5)} ${organizationLabel(data.organizations, point.organization)} 사정률 ${rateText(point.floor, 3)}`)
          .join(' · ')}`;
  if (sorted.length < MIN_RANGE_COUNT) {
    return { headline, range: null, caution: '이 기간엔 공고가 적어 범위를 말하기 어려워요.', thisMonth };
  }
  const low = quantileOf(sorted, 0.25);
  const high = quantileOf(sorted, 0.75);
  const middle = quantileOf(sorted, 0.5);
  return {
    headline,
    range: {
      lead: '열 번 중 다섯 번은 하한선이 ',
      strong: `사정률 ${rateText(low, 1)}~${rateText(high, 1)}`,
      rest: `에 나왔어요. 기초금액의 ${low.toFixed(1)}~${high.toFixed(1)}%, 1억이면 ${per100MillionText(low)}~${per100MillionText(high)}이에요.`
    },
    caution: `이 안에 넣으면 된다는 뜻이 아니에요. 가운데인 사정률 ${rateText(middle, 1)}에 넣어도 절반은 하한 미달이에요. 범위가 넓어서 이것만으로는 넣을 자리를 못 정해요. 넣을 값은 "넣을 값 따져 보기"에서 확인하세요.`,
    thisMonth
  };
}
