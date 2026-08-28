export function formatDate(
  date: Date | string | number | undefined,
  opts: Intl.DateTimeFormatOptions = {}
) {
  if (!date) return '';

  try {
    return new Intl.DateTimeFormat('en-US', {
      month: opts.month ?? 'long',
      day: opts.day ?? 'numeric',
      year: opts.year ?? 'numeric',
      ...opts
    }).format(new Date(date));
  } catch {
    return '';
  }
}

/** ── eatbid 공용 포맷터·상수 — DESIGN.md D-2 (won 7파일·eok 3파일·CATS 3파일 중복 통합) ── */

/** 원 단위 콤마 표기 */
export const won = (n: number | null | undefined) =>
  n == null ? '-' : Math.round(n).toLocaleString();

/** 억/만 축약 표기 */
export const eok = (n: number | null | undefined) =>
  n == null ? '-' : n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${Math.round(n / 1e4).toLocaleString()}만`;

/** 품목 순서 — SSOT는 @eatbid/shared CATEGORIES. slice로 기타를 자르지 않는다(기타도 실재 데이터). */
export { CATEGORIES as CATS } from '@eatbid/shared';
