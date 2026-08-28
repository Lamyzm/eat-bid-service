/**
 * 날짜 기준 — 이 제품의 "오늘"은 한국 시간이다.
 *
 * `new Date().toISOString().slice(0, 10)` 은 UTC 기준이라 매일 09시 이전에 하루가 어긋난다.
 * 개찰일·마감일·납품기간이 전부 한국 날짜라 그 사이 화면이 어제를 오늘이라고 말한다.
 * 서버와 웹이 같은 함수를 쓴다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 시간 기준 날짜 문자열 (YYYY-MM-DD) */
export function kstDate(at: number | Date = Date.now()): string {
  const ms = typeof at === 'number' ? at : at.getTime();
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 오늘 (한국 시간) */
export function todayKST(): string {
  return kstDate();
}

/** n일 전 (한국 시간) */
export function daysAgoKST(n: number, at: number = Date.now()): string {
  return kstDate(at - n * 86_400_000);
}

/** n개월 전 (한국 시간) */
export function monthsAgoKST(n: number, at: number = Date.now()): string {
  const d = new Date(at + KST_OFFSET_MS);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

/** 한국 시간 기준 시각 (HH:MM) */
export function kstTime(at: number | Date): string {
  const ms = typeof at === 'number' ? at : at.getTime();
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(11, 16);
}

/** 한국 시간 기준 자정 (Date) — 하루 단위 계산의 기준점 */
export function startOfDayKST(at: number = Date.now()): Date {
  return new Date(`${kstDate(at)}T00:00:00+09:00`);
}

/** 두 날짜(YYYY-MM-DD) 사이의 일수 */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00+09:00`) - Date.parse(`${from}T00:00:00+09:00`)) / 86_400_000,
  );
}
