/**
 * @module 책임: "이 값으로 넣으면" 칸의 입력(사정률 또는 기초금액 대비 %)을 읽어 하한 미달 확률을 추첨 분포와 고른 지역 실제 기록으로 말한다.
 *
 * 확률은 넣는 값이 하한선 아래로 떨어질 가능성일 뿐 낙찰 가능성이 아니다. 하한 위라도 그 사이에 다른 업체가 있으면 못 딴다는 문장을
 * 늘 함께 둔다.
 */
import { belowFloorProbability } from '@/app/(workspace)/floor/_lib/floor-rule';
import { basePercentOf, countText, per100MillionText, rateText } from '@/entities/floor-line/floor-units';
import type { FloorPoint } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';

export type TryUnit = 'rate' | 'base';

/** 받는 값의 범위다(기초금액 대비 %). 하한율 90%에서 하한선은 이 안에 든다. 밖의 값은 오타로 본다. */
const LOW = 80;
const HIGH = 100;

/** 입력 글자를 기초금액 대비 %로 읽는다. 숫자가 아니거나 범위 밖이면 null이다. */
export function tryValueBasePercent(text: string, unit: TryUnit): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const base = unit === 'rate' ? basePercentOf(value) : value;
  return base >= LOW && base <= HIGH ? base : null;
}

export interface TryView {
  readonly lead: string;
  readonly strong: string;
  readonly detail: string;
}

export function presentTry(input: {
  readonly basePercent: number;
  readonly quantiles: readonly number[];
  readonly points: readonly FloorPoint[];
  readonly place: string;
  readonly rounds: number;
}): TryView {
  const probability = belowFloorProbability(input.quantiles, input.basePercent);
  const over = input.points.filter((point) => point.floor > input.basePercent).length;
  const share = input.points.length === 0 ? null : Math.round((100 * over) / input.points.length);
  const percent = Math.round(100 * probability);
  return {
    lead: `사정률 ${rateText(input.basePercent, 3)}(기초금액의 ${input.basePercent.toFixed(3)}%)로 넣으면 하한 미달이 되는 건 `,
    strong: `20번 중 약 ${Math.round(probability * 20)}번(${percent}%)`,
    detail:
      `전국 하한율 90% 공고 ${countText(input.rounds)}건으로 본 추첨 분포로는 ${percent}%` +
      (share === null ? '' : `, ${input.place} 고른 기간 실제 ${countText(input.points.length)}건에서는 ${share}%(${countText(over)}건)`) +
      `였어요. 기초금액 1억이면 이 값은 ${per100MillionText(input.basePercent)}이에요.`
  };
}
