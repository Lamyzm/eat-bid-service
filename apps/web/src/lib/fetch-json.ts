'use client';
/**
 * 목록 조회 — 실패를 삼키지 않는다.
 * `.catch(() => {})` 로 빈 배열이 남으면 화면이 "없습니다"라고 말한다.
 * 서버가 죽었는데 "공고가 없다"고 하는 것과 같아서, 못 받은 것과 없는 것을 구분해야 한다.
 */
export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** AbortController 로 취소된 요청인가 — 화면에 실패로 표시하면 안 된다 */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}
