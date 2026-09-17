/** @module 책임: 열린 공고 요약 응답을 탭 셋·2주 마감 달력·축 줄 건수의 표시값으로 바꾸고, 못 센 수와 0건인 날을 0으로 위장하지 않는다. */
import { Temporal } from '@eatbid/domain';
import type { OpenAuctionSummaryV1Response } from '@eatbid/contracts/api/v1/auctions';

import { FLOOR_RATE_UNKNOWN, formatFloorRate } from './today-formats';

const KST = 'Asia/Seoul';

/** 달력이 두 주를 보인다. 이번 주 월요일부터 14칸이라 오늘이 무슨 요일이어도 격자의 모양이 같다. */
export const CALENDAR_WINDOW_DAYS = 14;

export function kstToday(nowIso: string): Temporal.PlainDate {
  return Temporal.Instant.from(nowIso).toZonedDateTimeISO(KST).toPlainDate();
}

/**
 * 달력 창의 시작이다. 오늘을 왼쪽 끝에 두지 않고 이번 주 월요일에 맞춘다.
 *
 * 오늘을 시작으로 두면 같은 화면이 요일마다 다른 격자가 되어 `수요일 칸`이 매일 옮겨 다닌다. 요일 머리가
 * 고정돼야 사용자가 "다음 주 화요일"을 눈으로 찾는다. 지나간 며칠은 칸을 차지하지만 지남으로 표시한다.
 */
export function calendarWindow(nowIso: string): { readonly from: string; readonly to: string } {
  const today = kstToday(nowIso);
  const from = today.subtract({ days: today.dayOfWeek - 1 });
  return { from: from.toString(), to: from.add({ days: CALENDAR_WINDOW_DAYS - 1 }).toString() };
}

/**
 * 달력 칸 하나다. `tone`이 그 칸에 무엇을 그릴지를 정한다.
 *
 * `past`는 창 안이지만 오늘보다 앞이라 열린 공고가 있을 수 없는 날이다. 0으로 그리면 "그날은 마감이
 * 없었다"로 읽히지만 사실은 이 목록이 답하는 질문 밖이다(AGENTS 3).
 */
export type CalendarCellTone = 'past' | 'today' | 'empty' | 'has';

export type CalendarCellPresentation = {
  readonly date: string;
  readonly dayText: string;
  readonly tone: CalendarCellTone;
  readonly count: number;
  /**
   * 지역 축만 남기고 품목·금액을 푼 수다. 목록의 마감일 묶음 머리가 `2건 · 7건 중`으로 쓴다. 조건을
   * 좁힌 채로도 그날 판이 얼마나 큰지 보이지 않으면 사용자가 자기 조건이 무엇을 가렸는지 모른다.
   */
  readonly releasedCount: number;
  /** 그날 건수를 창 안 최대와 견준 0..1이다. 색 농도만 정하고 수는 언제나 함께 적는다. */
  readonly weight: number;
  readonly selected: boolean;
};

/**
 * 탭 하나다. `count`가 null이면 셀 수 없었다는 뜻이고 화면은 0이 아니라 `?`를 적는다.
 * 지어낸 0과 관측된 0은 사용자가 할 일이 다르다.
 */
export type TabPresentation = {
  readonly id: 'live' | 'openedToday' | 'closingToday';
  readonly label: string;
  readonly count: number | null;
  readonly active: boolean;
};

/**
 * 하한율이 결과 집합의 속성인지 행의 속성인지는 값의 가짓수가 정한다.
 *
 * 한 종류뿐이면 그건 이 목록 전체에 대한 한 문장이다. 행마다 열을 내주고 같은 수를 서른 번 적을 일이
 * 아니라 축 줄에 한 번 적는다. 열을 두고 칸만 비우는 것도 안 된다 — 한 번도 안 차는 열은 열로 읽히지
 * 않고 기초금액과 참여 사이의 빈 간격으로 읽힌다.
 *
 * 두 종류 이상이면 축 줄이 나눠 세고 드문 쪽만 기초금액 칸 아래에 붙는다. 이때도 열을 새로 만들지
 * 않는다. 열이 생겼다 없어지면 표가 다시 짜여 보고 있던 줄을 놓친다.
 *
 * **세는 근거는 목록 페이지가 아니라 요약이다.** 페이지에서 세면 `limit`에 걸린 50행의 구성이 되고,
 * 다음 페이지로 넘어갈 때 같은 조건인데 축 줄 문장이 바뀐다.
 */
export type FloorRateSpread = {
  /** 축 줄에 적는 한 문장이다. `하한 90` 또는 `하한 90 · 31 / 88 · 6`. */
  readonly axisText: string;
  /** 이 결과에서 드문 하한이라 행에 따로 적어야 하는 값들이다. 한 종류뿐이면 빈 집합이다. */
  readonly rareRates: ReadonlySet<string>;
};

function floorSpread(shares: OpenAuctionSummaryV1Response['floorShares']): FloorRateSpread {
  if (shares.length === 0) return { axisText: '', rareRates: new Set() };
  const labelled = shares.map((share) => ({
    text: share.rate === null ? FLOOR_RATE_UNKNOWN : formatFloorRate(share.rate.value),
    count: share.count
  }));
  // 서버가 이미 많은 것부터 내림차순으로 준다. 여기서 다시 정렬하면 동률을 끊는 규칙이 두 곳에 산다.
  if (labelled.length === 1) return { axisText: `하한 ${labelled[0]!.text}`, rareRates: new Set() };
  const axisText = `하한 ${labelled.map((share) => `${share.text} · ${share.count}`).join(' / ')}`;
  // 드문 쪽은 **최빈값이 과반일 때만** 있다. 4 대 4로 갈린 목록에서 뒤쪽을 드물다고 부르면 절반의 행에
  // 배지가 붙어 `찾을 것이 여섯`이라는 뜻이 사라지고, 동률을 끊은 쪽이 어디냐에 따라 표가 달라 보인다.
  // 그때는 축 줄이 이미 `82.995 · 4 / 90 · 4`로 다 말하고 있으므로 행에 더 적을 것이 없다.
  const total = labelled.reduce((sum, share) => sum + share.count, 0);
  if (labelled[0]!.count * 2 <= total) return { axisText, rareRates: new Set() };
  return { axisText, rareRates: new Set(labelled.slice(1).map((share) => share.text)) };
}

export type OpenSummaryPresentation = {
  readonly tabs: readonly TabPresentation[];
  readonly calendar: readonly CalendarCellPresentation[];
  readonly totalCount: number;
  readonly organizationCount: number;
  /**
   * 게시일을 관측하지 못한 행 수다. 0이면 화면이 아무 말도 하지 않는다 — 0건이라는 사실은 사용자가
   * 할 일이 없는 사실이고, 그걸 적으면 다른 수치들 사이에서 무게를 갖는다.
   */
  readonly announcedUnobservedCount: number;
  readonly floorSpread: FloorRateSpread;
  /**
   * 조건 기둥의 배지 재료다. 요약이 "그 축 하나만 푼 집합"으로 세어 온 수를 그대로 넘기고, 줄과 링크로
   * 만드는 일은 기둥의 표시 모델(`_features/condition-rail`)이 주소를 함께 보며 한다.
   */
  readonly railCounts: Pick<
    OpenAuctionSummaryV1Response,
    'sidoCounts' | 'sigunguCounts' | 'regionUnobservedCount' | 'itemCounts' | 'itemUnobservedCount'
  >;
  /** `9월 14일 ~ 27일`. 칸에는 날짜 숫자만 있어 어느 달의 며칠인지를 이 한 줄이 말한다. */
  readonly windowText: string;
  readonly latestObservedText: string | null;
  readonly nextClosingDay: { readonly date: string; readonly dayText: string; readonly count: number } | null;
};

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function dayTextOf(date: Temporal.PlainDate, today: Temporal.PlainDate): string {
  if (date.equals(today)) return '오늘';
  // 달을 넘는 칸만 월을 적는다. 열네 칸에 `9월`을 열네 번 적으면 날짜가 안 읽힌다.
  return date.day === 1 ? `${date.month}/1` : String(date.day);
}

/**
 * 달력 밖 문장에 쓰는 날짜다. 칸의 `15`는 요일 머리와 격자가 있어야 읽히는 글자라, 문장에 그대로 옮기면
 * `마감이 가장 이른 날 15`처럼 무엇의 15인지 안 말하는 문구가 된다.
 */
function markTextOf(date: Temporal.PlainDate, today: Temporal.PlainDate): string {
  return date.equals(today) ? '오늘' : `${pad2(date.month)}-${pad2(date.day)}`;
}

/** 창의 양끝이다. 같은 달이면 뒤쪽 달을 되풀이하지 않는다. */
function windowTextOf(from: string, to: string): string {
  const start = Temporal.PlainDate.from(from);
  const end = Temporal.PlainDate.from(to);
  const tail = start.month === end.month ? `${end.day}일` : `${end.month}월 ${end.day}일`;
  return `${start.month}월 ${start.day}일 ~ ${tail}`;
}

function kstDateTime(instant: string): string {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(KST);
  return `${pad2(zoned.month)}-${pad2(zoned.day)} ${pad2(zoned.hour)}:${pad2(zoned.minute)}`;
}

function calendarCells(
  response: OpenAuctionSummaryV1Response,
  today: Temporal.PlainDate,
  selectedDate: string | null
): readonly CalendarCellPresentation[] {
  // 색 농도의 분모는 창 안에서 실제로 관측된 최댓값이다. 고정값을 쓰면 한산한 주가 통째로 하얗게 되고
  // 바쁜 주가 통째로 진해져 두 주를 나란히 볼 때 차이가 사라진다.
  const peak = response.calendar.reduce((max, day) => Math.max(max, day.count), 0);
  return response.calendar.map((day) => {
    const date = Temporal.PlainDate.from(day.date);
    const past = Temporal.PlainDate.compare(date, today) < 0;
    const tone: CalendarCellTone = past ? 'past' : date.equals(today) ? 'today' : day.count === 0 ? 'empty' : 'has';
    return {
      date: day.date,
      dayText: dayTextOf(date, today),
      tone,
      count: day.count,
      releasedCount: day.releasedCount,
      weight: past || peak === 0 ? 0 : day.count / peak,
      selected: day.date === selectedDate
    };
  });
}

/**
 * `진행중` 탭의 수는 요약이 따로 싣지 않는다. 날짜 축을 받지 않는 요약이라 조건을 만족하는 전체가 곧
 * 진행중이며, 같은 수를 두 자리에 두면 언젠가 한쪽만 고쳐져 탭과 축 줄이 다른 말을 한다.
 */
function tabs(
  response: OpenAuctionSummaryV1Response,
  today: string,
  search: { readonly closesOn: string | null; readonly announcedOn: string | null }
): readonly TabPresentation[] {
  const closingToday = search.closesOn === today;
  const openedToday = search.announcedOn === today;
  // `진행중`은 날짜 축이 **아예 없을 때만** 켜진다. 오늘이 아닌 달력 칸을 고르면 셋 다 꺼지고 그 칸이
  // 켜진다. `!closingToday && !openedToday`로 쓰면 다음 주 화요일을 골라도 진행중이 켜진 채로 남는다.
  const noDateAxis = search.closesOn === null && search.announcedOn === null;
  return [
    { id: 'live', label: '진행중', count: response.totalCount, active: noDateAxis },
    { id: 'openedToday', label: '오늘 열린', count: response.tabs.openedToday, active: openedToday },
    { id: 'closingToday', label: '오늘 마감', count: response.tabs.closingToday, active: closingToday }
  ];
}

export function presentOpenSummary(
  response: OpenAuctionSummaryV1Response,
  nowIso: string,
  search: { readonly closesOn: string | null; readonly announcedOn: string | null }
): OpenSummaryPresentation {
  const today = kstToday(nowIso);
  const todayText = today.toString();
  const next = response.nextClosingDay;
  return {
    tabs: tabs(response, todayText, search),
    calendar: calendarCells(response, today, search.closesOn),
    totalCount: response.totalCount,
    organizationCount: response.organizationCount,
    announcedUnobservedCount: response.announcedUnobservedCount,
    floorSpread: floorSpread(response.floorShares),
    railCounts: {
      sidoCounts: response.sidoCounts,
      sigunguCounts: response.sigunguCounts,
      regionUnobservedCount: response.regionUnobservedCount,
      itemCounts: response.itemCounts,
      itemUnobservedCount: response.itemUnobservedCount
    },
    windowText: windowTextOf(response.meta.calendarFrom, response.meta.calendarTo),
    latestObservedText: response.latestObservedAt === null ? null : kstDateTime(response.latestObservedAt),
    nextClosingDay: next === null
      ? null
      : { date: next.date, dayText: markTextOf(Temporal.PlainDate.from(next.date), today), count: next.count }
  };
}
