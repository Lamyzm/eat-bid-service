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

/**
 * 화면에 드러낼 자리가 없는 실패 — 보조 조회라 빈 상태가 거짓말이 되지 않는 곳에만 쓴다.
 * 지금은 조용히 넘기지만, 이 함수 하나가 로깅 훅 자리다(SPEC-LOGGING).
 * `.catch(() => {})` 를 직접 쓰지 마라 — 그러면 로깅을 24곳에 흩게 된다.
 */
export function quietFailure(what: string) {
  return (e: unknown) => {
    if (isAbort(e)) return;
    // 로깅 훅: 여기 한 곳만 바꾸면 모든 조용한 실패가 잡힌다
    void what;
  };
}

/** AbortController 로 취소된 요청인가 — 화면에 실패로 표시하면 안 된다 */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}
