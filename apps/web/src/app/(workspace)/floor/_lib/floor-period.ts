/**
 * @module 책임: 기간 칩(최근 3달·1년·3년)을 조회 창(양끝 포함 KST 날짜)과 달 경계 시각으로 바꾼다.
 *
 * 창은 달 첫날에서 시작한다. 중간에서 자르면 첫 달이 반쪽이 되어 그 달 "가장 많이 나온 칸"이 다른 달과 다른 수의 공고로 골라진다.
 * 그래서 "최근 1년"은 열두 달 전 1일부터 오늘까지다. 가장 긴 창(36달 + 이번 달)도 계약의 기간 상한(1,130일) 안에 든다.
 */
import { Temporal } from '@eatbid/domain';

import type { FloorPeriodKey } from './floor-search';

const MONTHS_BACK: Record<FloorPeriodKey, number> = { '3m': 3, '1y': 12, '3y': 36 };
const LABEL: Record<FloorPeriodKey, string> = { '3m': '최근 3달', '1y': '최근 1년', '3y': '최근 3년' };

export interface FloorPeriod {
  readonly key: FloorPeriodKey;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  /** 오늘이 든 달(`2026-10`)이다. 이 달은 개찰이 끝난 공고만 있어 다른 달과 따로 말한다. */
  readonly currentMonth: string;
  /** 창 안 달마다 첫날 0시(KST)의 epoch 밀리초다. 다음 달 첫날까지 담아 달 띠의 오른쪽 끝을 그린다. */
  readonly monthStarts: Readonly<Record<string, number>>;
  /** 창의 양끝 epoch 밀리초다. 끝은 오늘 다음 날 0시(KST)라 오늘 개찰한 공고까지 든다. */
  readonly start: number;
  readonly end: number;
}

const monthKey = (month: Temporal.PlainYearMonth) => month.toString();

export function floorPeriod(today: Temporal.PlainDate, key: FloorPeriodKey): FloorPeriod {
  const current = today.toPlainYearMonth();
  const first = current.subtract({ months: MONTHS_BACK[key] });
  const monthStarts: Record<string, number> = {};
  for (let month = first; Temporal.PlainYearMonth.compare(month, current.add({ months: 1 })) <= 0; month = month.add({ months: 1 })) {
    monthStarts[monthKey(month)] = month.toPlainDate({ day: 1 }).toZonedDateTime('Asia/Seoul').epochMilliseconds;
  }
  return {
    key,
    label: LABEL[key],
    from: first.toPlainDate({ day: 1 }).toString(),
    to: today.toString(),
    currentMonth: monthKey(current),
    monthStarts,
    start: first.toPlainDate({ day: 1 }).toZonedDateTime('Asia/Seoul').epochMilliseconds,
    end: today.add({ days: 1 }).toZonedDateTime('Asia/Seoul').epochMilliseconds
  };
}
