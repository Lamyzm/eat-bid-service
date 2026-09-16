/** @module 책임: 마감 임박 순 행을 KST 마감일 묶음으로 나누고, 그 묶음 머리가 말할 날짜·요일·남은 날과 조건 건수·조건 푼 건수를 요약에서 찾아 붙인다. */
import { Temporal } from '@eatbid/domain';

import { dayAwayText, type ClosesTone, type OpenAuctionRowPresentation } from './present-open-auctions';
import type { OpenSummaryPresentation } from './present-open-summary';

const KST = 'Asia/Seoul';
const WEEKDAY = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'] as const;

/**
 * 마감일 묶음 하나다.
 *
 * `count`는 이 조건에서 그날 전체 건수이고 `rows`는 그중 이 페이지에 실린 행이다. 둘이 다를 수 있는 것은
 * 목록이 `limit`으로 끊기기 때문이고, 묶음 머리는 끊기기 전 수를 말해야 사용자가 더 있다는 것을 안다.
 *
 * `releasedCount`는 지역 축만 남기고 품목·금액을 푼 수다. `2건 · 7건 중`의 뒤쪽이며 조건을 풀면 그날
 * 얼마나 더 있는지를 말한다.
 *
 * 둘 다 요약의 달력 창에서 찾는다. 창 밖(열네 칸 너머)에 마감하는 행은 셀 근거가 없어 `null`이다 —
 * 0으로 적으면 행이 눈앞에 있는데 0건이라고 말하는 머리가 된다(AGENTS 3).
 */
export type ClosingDayGroup = {
  /** KST 날짜 문자열이거나, 마감을 관측하지 못한 묶음의 `unknown`이다. */
  readonly key: string;
  readonly dateText: string;
  /** `수요일 · 사흘 뒤`. 마감 미확인 묶음은 빈 문자열이다. */
  readonly awayText: string;
  readonly tone: ClosesTone;
  readonly count: number | null;
  readonly releasedCount: number | null;
  readonly rows: readonly OpenAuctionRowPresentation[];
  /** 목록 전체에서 이 묶음의 첫 행이 몇 번째인지. 순번은 묶음마다 1로 돌아가지 않는다. */
  readonly firstRank: number;
};

/**
 * 행이 속한 KST 마감일이다. 표시 모델에 날짜가 따로 없고 `dDay`만 있으므로 오늘에서 되짚는다.
 * `dDay`를 만든 `nowIso`와 같은 값을 쓰므로 되짚은 날짜가 원래 마감일과 같다.
 */
function dateKeyOf(dDay: number | null, today: Temporal.PlainDate): string {
  return dDay === null ? 'unknown' : today.add({ days: dDay }).toString();
}

export function groupClosingDays(
  rows: readonly OpenAuctionRowPresentation[],
  nowIso: string,
  summary: OpenSummaryPresentation | null
): readonly ClosingDayGroup[] {
  const today = Temporal.Instant.from(nowIso).toZonedDateTimeISO(KST).toPlainDate();
  const calendar = new Map((summary?.calendar ?? []).map((cell) => [cell.date, cell]));
  return rows.reduce<ClosingDayGroup[]>((built, row, index) => {
    const key = dateKeyOf(row.closes.dDay, today);
    const last = built.at(-1);
    // 행이 이미 마감 임박 순이라 같은 날은 붙어 있다. 날짜로 다시 모으지 않고 바뀌는 자리에서만 끊는다.
    if (last !== undefined && last.key === key) {
      built[built.length - 1] = { ...last, rows: [...last.rows, row] };
      return built;
    }
    const cell = calendar.get(key);
    const date = key === 'unknown' ? null : Temporal.PlainDate.from(key);
    built.push({
      key,
      dateText: date === null ? '마감 미확인' : `${date.month}월 ${date.day}일`,
      awayText: date === null ? '' : `${WEEKDAY[date.dayOfWeek - 1]!} · ${dayAwayText(row.closes.dDay ?? 0)}`,
      tone: row.closes.tone,
      count: cell?.count ?? null,
      releasedCount: cell?.releasedCount ?? null,
      rows: [row],
      firstRank: index + 1
    });
    return built;
  }, []);
}
