/** @module 책임: 마감 임박 순 행을 KST 마감 시각(날짜+시각) 묶음으로 나누고, 묶음 머리가 말할 시각·남은 시간·건수와 날짜가 바뀌는 자리를 정한다. */
import { Temporal } from '@eatbid/domain';

import { dayAwayText, type ClosesTone, type OpenAuctionRowPresentation } from './present-open-auctions';

const KST = 'Asia/Seoul';
const WEEKDAY = ['월', '화', '수', '목', '금', '토', '일'] as const;

/**
 * 마감 시각 묶음 하나다(U9). 같은 날 같은 시각에 닫히는 공고가 한 묶음이고, 묶음 머리가 시각과 남은 시간을
 * 한 번 말하므로 행에는 시각이 없다. 학교 급식 공고는 오전 9시·10시에 몰리므로 날짜 묶음 하나로는 스무 행이
 * 한 덩어리가 되고, 시각 묶음이어야 "다음 한 시간 안에 닫히는 것"이 한눈에 잘린다.
 *
 * `count`는 이 페이지에 실린 행 수다. 목록 상한(200) 밖의 행은 세지 않는다 — 셀 근거가 없는 수를 0으로도
 * 전체로도 적지 않는다(AGENTS 3). 그날 전체 건수는 달력 칸이 말한다.
 */
export type ClosingSlotGroup = {
  /** `YYYY-MM-DD HH:mm`이거나, 마감을 관측하지 못한 묶음의 `unknown`이다. */
  readonly key: string;
  /** 오늘은 `오전 9시 마감`, 다른 날은 `9월 17일 목 · 오전 9시 마감`, 미관측은 `마감 미확인`이다. */
  readonly titleText: string;
  /** 오늘은 `3시간 뒤`·`40분 뒤`·`지났어요`, 다른 날은 `내일`·`사흘 뒤`다. 미관측은 빈 문자열이다. */
  readonly awayText: string;
  readonly tone: ClosesTone;
  /** 이미 지난 시각의 묶음이다. 목록은 열린 공고만 싣지만 스냅샷 산출과 보는 시점 사이에 닫힌 것이 있다. */
  readonly past: boolean;
  /** 앞 묶음과 날짜가 다른 첫 묶음이다. 여기서 날짜가 바뀌었다는 선을 긋는다. */
  readonly newDay: boolean;
  readonly count: number;
  readonly rows: readonly OpenAuctionRowPresentation[];
};

/** `오전 9시`·`오후 3시 30분`. 24시간 눈금은 표의 글자이고 말은 오전·오후로 센다. */
export function koreanClockText(hour: number, minute: number): string {
  const meridiem = hour < 12 ? '오전' : '오후';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${meridiem} ${twelve}시` : `${meridiem} ${twelve}시 ${minute}분`;
}

/**
 * 남은 시간이다. 한 시간 안이면 분으로, 그 뒤는 시간으로 센다 — `0시간 뒤`는 말이 아니다. 지난 시각은
 * 0이 아니라 `지났어요`다.
 */
function hoursAwayText(closes: Temporal.ZonedDateTime, now: Temporal.ZonedDateTime): string {
  const minutes = Math.floor(now.until(closes, { largestUnit: 'minutes' }).minutes);
  if (minutes < 0) return '지났어요';
  if (minutes < 60) return `${minutes}분 뒤`;
  return `${Math.floor(minutes / 60)}시간 뒤`;
}

export function groupClosingSlots(rows: readonly OpenAuctionRowPresentation[], nowIso: string): readonly ClosingSlotGroup[] {
  const now = Temporal.Instant.from(nowIso).toZonedDateTimeISO(KST);
  const today = now.toPlainDate();
  return rows.reduce<ClosingSlotGroup[]>((built, row) => {
    const closes = row.closes.at === null ? null : Temporal.Instant.from(row.closes.at).toZonedDateTimeISO(KST);
    const key = closes === null ? 'unknown' : `${closes.toPlainDate().toString()} ${row.closes.clockText}`;
    const last = built.at(-1);
    // 행이 이미 마감 임박 순이라 같은 시각은 붙어 있다. 다시 모으지 않고 바뀌는 자리에서만 끊는다.
    if (last !== undefined && last.key === key) {
      built[built.length - 1] = { ...last, rows: [...last.rows, row], count: last.count + 1 };
      return built;
    }
    const lastDate = last === undefined ? null : last.key.slice(0, 10);
    const thisDate = key === 'unknown' ? 'unknown' : key.slice(0, 10);
    if (closes === null) {
      built.push({ key, titleText: '마감 미확인', awayText: '', tone: 'unknown', past: false, newDay: last !== undefined && lastDate !== thisDate, count: 1, rows: [row] });
      return built;
    }
    const clock = `${koreanClockText(closes.hour, closes.minute)} 마감`;
    const isToday = Temporal.PlainDate.compare(closes.toPlainDate(), today) === 0;
    const away = isToday ? hoursAwayText(closes, now) : dayAwayText(row.closes.dDay ?? 0);
    built.push({
      key,
      titleText: isToday ? clock : `${closes.month}월 ${closes.day}일 ${WEEKDAY[closes.dayOfWeek - 1]!} · ${clock}`,
      awayText: away,
      tone: row.closes.tone,
      past: away === '지났어요',
      newDay: last !== undefined && lastDate !== thisDate,
      count: 1,
      rows: [row]
    });
    return built;
  }, []);
}
