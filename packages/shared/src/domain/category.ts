/**
 * 품목 SSOT — 축산·수산·김치·농산·공산·기타의 유일한 정의.
 *
 * 값과 순서는 수집 파이프라인의 분류 규칙(tools/serve/load_postgres.py CAT_KEYS)에서
 * 나온다. 그쪽이 원천이고 여기는 계약이다. 규칙이 바뀌면 이 파일도 함께 고친다.
 *
 * 이 파일이 생기기 전에는 정의가 세 곳에 흩어져 서로 달랐다:
 *   - domain/auction.ts 의 z.enum 에 김치가 빠져 있었다(회차 10,024건·열린 공고 18건)
 *   - apps/web 의 CATS 는 6종이지만 slice(0,5) 로 기타를 잘라 일부 화면에서 못 골랐다
 * 화면·서버·검증이 같은 목록을 보게 하는 것이 이 파일의 목적이다.
 */

/** 전 품목 — 표시 순서이자 정렬 기준. 취급량이 아니라 사장이 읽는 순서다. */
export const CATEGORIES = ["축산", "수산", "공산", "농산", "김치", "기타"] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * 분류 규칙에 이름이 걸리지 않은 나머지. 버리는 값이 아니라 실재하는 묶음이라
 * (회차 7,839건) 필터·차트에서 빼지 않는다.
 */
export const CATEGORY_OTHER: Category = "기타";

/** 분류 규칙이 이름으로 가르는 품목 — 기타를 뺀 나머지. */
export const NAMED_CATEGORIES = CATEGORIES.filter(
  (c) => c !== CATEGORY_OTHER
) as readonly Category[];

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

/** 정렬용 순위. 목록에 없는 값은 맨 뒤로 보낸다. */
export function categoryOrder(v: string): number {
  const i = (CATEGORIES as readonly string[]).indexOf(v);
  return i === -1 ? CATEGORIES.length : i;
}
