/**
 * @module 책임: 오늘 투찰을 화면 안에서 학교 이름으로 좁히는 판정(검색어 다듬기·행이 맞는지·남은 건수 문장)을 소유한다.
 *
 * 서버를 다시 부르지 않는다. 오늘 투찰은 열린 공고를 한 번에 받으므로 이미 받은 행을 거르면 된다(2026-10-14 사용자 "클라필터").
 * 공백은 무시한다 — "덕정 초"와 "덕정초"가 같은 학교이고, eaT 기관 이름은 띄어쓰기가 공고마다 다르다.
 */
export interface SchoolFilterTarget {
  readonly organization: string;
  readonly title: string | null;
}

export function schoolQueryKey(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/** 검색어가 비면 모든 행이 맞는다. 학교 이름에 없으면 제목에서 찾는다 — 기관 이름이 비어 제목에만 학교가 있는 공고가 있다. */
export function matchesSchool(key: string, target: SchoolFilterTarget): boolean {
  if (key === '') return true;
  return schoolQueryKey(target.organization).includes(key) || schoolQueryKey(target.title ?? '').includes(key);
}

export function matchedCount(key: string, targets: readonly SchoolFilterTarget[]): number {
  return targets.filter((target) => matchesSchool(key, target)).length;
}

/** 남은 건수 문장이다. 검색어가 없으면 말하지 않는다. */
export function schoolFilterStatus(query: string, matched: number, total: number): string | null {
  if (schoolQueryKey(query) === '') return null;
  return matched === 0 ? `'${query.trim()}'에 맞는 학교 공고가 없어요.` : `${total}건 중 ${matched}건`;
}
