/**
 * @module 책임: 하한선 자리의 기간(최근 3달·1년·3년, 또는 한 달)을 조회 창(양끝 포함 KST 날짜)과 달 경계 시각으로 바꾼다. 하한선 자리와
 * 그 입구 줄(오늘 투찰·복기·공고 상세)이 같은 창을 써야 같은 숫자를 말한다.
 *
 * 창은 달 첫날에서 시작한다. 중간에서 자르면 첫 달이 반쪽이 되어 그 달 "가장 많이 나온 칸"이 다른 달과 다른 수의 공고로 골라진다.
 * 그래서 "최근 1년"은 열두 달 전 1일부터 오늘까지다. 가장 긴 창(36달 + 이번 달)도 계약의 기간 상한(1,130일) 안에 든다.
 */
import { Temporal } from '@eatbid/domain';


export const FLOOR_PERIODS = ['3m', '1y', '3y'] as const;
export type FloorPeriodKey = (typeof FLOOR_PERIODS)[number];

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

/** `2026-09` 꼴의 달이다. 주소에서 온 값은 이 모양일 때만 달로 읽는다. */
export function monthKeyOf(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

/** 한 달의 조회 창이다. 복기 입구 줄이 그 달 공고만 센다. 이번 달이면 오늘까지다. */
export function monthWindow(today: Temporal.PlainDate, month: string): { readonly from: string; readonly to: string } {
  const yearMonth = Temporal.PlainYearMonth.from(month);
  const last = yearMonth.toPlainDate({ day: yearMonth.daysInMonth });
  return { from: yearMonth.toPlainDate({ day: 1 }).toString(), to: (Temporal.PlainDate.compare(last, today) > 0 ? today : last).toString() };
}

/** 그 달이 들어가는 가장 짧은 기간 칩이다. 복기에서 오래된 달로 들어와도 하한선 자리가 그 달을 담게 한다. */
export function periodContaining(today: Temporal.PlainDate, month: string): FloorPeriodKey {
  const yearMonth = Temporal.PlainYearMonth.from(month);
  for (const key of FLOOR_PERIODS) {
    const start = Temporal.PlainYearMonth.from(floorPeriod(today, key).from.slice(0, 7));
    if (Temporal.PlainYearMonth.compare(yearMonth, start) >= 0) return key;
  }
  return '3y';
}
