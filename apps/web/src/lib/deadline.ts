/**
 * 마감 표시 — 한 곳에서만 만든다.
 *
 * 같은 계산이 오늘 카드·공고 상세·분석판 세 곳에 글자 단위로 복사돼 있었다(D-3).
 * 곧 기준 값 자체가 바뀐다: 지금 `deadline`은 **개찰 시각**(OPNG_DT)에서 오는데
 * 실제 마감(BID_END_DT)은 그보다 **정확히 1시간 이르다**(표본 1,200건, 결측 0건).
 * 즉 지금 화면의 `마감 1시간 전`은 이미 마감된 공고다.
 *
 * data가 `bid_end_at`을 실어 보내면 호출부는 그대로 두고 여기 입력만 바꾼다.
 * 개찰 시각도 계속 필요하므로(개찰 결과를 언제 보나) 둘을 덮어쓰지 않는다.
 */

/** 마감까지 남은 시간 표시. 지난 공고는 `마감됨`. 값이 없으면 null(문장을 만들지 않는다) */
export function deadlineText(deadline: string | null | undefined, now: number = Date.now()): string | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  if (Number.isNaN(ms)) return null;
  if (ms < 0) return '마감됨';
  const h = Math.floor(ms / 36e5);
  return h < 24 ? `마감 ${h}시간 전` : `마감 D-${Math.floor(h / 24)}`;
}

/** 이미 지났는가 — 표시 색·정렬을 가르는 판정 */
export function isClosed(deadline: string | null | undefined, now: number = Date.now()): boolean {
  if (!deadline) return false;
  const ms = new Date(deadline).getTime() - now;
  return !Number.isNaN(ms) && ms < 0;
}

/** 남은 시간(시). 마감 경고 문턱 판정에 쓴다. 값이 없으면 null */
export function hoursLeft(deadline: string | null | undefined, now: number = Date.now()): number | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  return Number.isNaN(ms) ? null : ms / 36e5;
}
