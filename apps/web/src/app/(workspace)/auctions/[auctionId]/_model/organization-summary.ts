/** @module 책임: 레일 "이 학교와 내 기록 더 보기" 펼침이 보이는 기관 요약(누적 회차·최근 낙찰·발주 주기)을 선택 품목 회차 이력에서 손잡이 값과 무관하게 순수 계산한다. */
import type { HistoryRow } from './attempt-history';

export type OrganizationSummary = {
  /** 이 화면이 받은 선택 품목의 개찰 회차 수. 기관 전체 표본 수(meta)와 다르므로 그렇게 부르지 않는다. */
  readonly rounds: number;
  /** 가장 최근에 낙찰률이 관측된 회차. 값은 사정률 축이라 화면은 축 이름을 함께 적는다(PDR-0004). */
  readonly latestWin: { readonly rateText: string; readonly openedText: string } | null;
  /** 이웃한 개찰일 간격의 가운데값(일). 회차가 둘 미만이면 간격 자체가 없어 null이다. */
  readonly cadenceDays: number | null;
};

function medianOf(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  // rehearsal.ts의 usualListCount와 같은 규칙(짝수 개면 위쪽 중간값)이라 두 요약이 다른 중앙값을 말하지 않는다.
  return sorted[Math.floor(sorted.length / 2)];
}

// 응답 순서(최근 → 오래된)를 믿지 않고 날짜로 다시 정렬한다. 같은 날 두 회차는 간격 0으로 남겨
// "하루에 두 번 발주"라는 사실이 가운데값에 그대로 반영되게 한다.
function cadenceDays(rows: readonly HistoryRow[]): number | null {
  if (rows.length < 2) return null;
  const days = rows.map((row) => row.openedKstDay).toSorted((a, b) => a - b);
  const gaps = days.slice(1).map((day, index) => day - days[index]);
  return medianOf(gaps);
}

export function summarizeOrganization(rows: readonly HistoryRow[]): OrganizationSummary {
  // rows는 최근 → 오래된 순이라 처음 만나는 낙찰률이 최근 낙찰이다. 낙찰률이 없는 회차는 아직 관측이
  // 없는 것이지 낙찰이 없었다는 뜻이 아니므로 건너뛴다(AGENTS 3).
  const latest = rows.find((row) => row.winRateText !== null);
  return {
    rounds: rows.length,
    latestWin: latest?.winRateText ? { rateText: latest.winRateText, openedText: latest.openedText } : null,
    cadenceDays: cadenceDays(rows)
  };
}
