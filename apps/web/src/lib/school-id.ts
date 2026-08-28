/**
 * 학교 id 를 URL 로 내보내고 받아오는 유일한 창구.
 *
 * 지금 id 는 `{시군구}|{학교명}` 문자열이고 분석판 URL 이 이 값을 그대로 쓴다.
 * 코드 기반 키로 갈아탈 때 **발급된 URL 이 죽지 않게** 하려면 변환 지점이 하나여야 한다.
 * (별칭 조회가 붙을 자리도 여기 한 곳이다 — 규칙으로 비교하지 않고 목록으로 조회한다)
 *
 * 인코딩 현황(실측): Next 16 은 라우트 세그먼트를 **디코드하지 않고** 준다.
 * `schools/[id]` 가 "이미 디코드됐다"고 가정해 한 번 더 인코딩하는 바람에
 * `%ED%99%94` 가 `%25ED%2599%2594` 가 되어 그 경로의 링크가 전부 죽어 있었다.
 * 그래서 받는 쪽은 "구분자가 남아 있으면 그대로, 아니면 한 번 푼다"로 방어한다.
 */

/** 라우트 세그먼트 → 학교 id */
export function schoolIdFromParam(param: string): string {
  if (param.includes('|')) return param; // 이미 풀린 값
  try {
    return decodeURIComponent(param);
  } catch {
    return param; // `%` 가 든 학교명에서 URIError 로 화면이 죽지 않게
  }
}

/** 학교 id → URL 경로 조각 */
export function schoolIdToPath(id: string): string {
  return encodeURIComponent(id);
}

/** id 를 시군구·학교명으로 가른다. 구분자가 없으면 전체를 학교명으로 본다 */
export function parseSchoolId(id: string): { sigungu: string | null; name: string } {
  const i = id.indexOf('|');
  if (i < 0) return { sigungu: null, name: id };
  return { sigungu: id.slice(0, i), name: id.slice(i + 1) };
}
