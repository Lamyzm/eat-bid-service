/**
 * 투찰률 입력 규칙 — 컴포넌트에서 떼어낸 순수 함수.
 * 화면 없이 검증할 수 있어야 하는 규칙이라 여기 둔다.
 */

export const MAX_DECIMALS = 4;

/** 타이핑 한 번의 결과. reject 면 입력 자체를 무시한다(값을 바꾸지 않는다). */
export type RateEdit =
  | { kind: 'reject' }
  | { kind: 'accept'; text: string; value: number | undefined };

/**
 * 입력칸에 글자가 들어왔을 때 무엇을 남길지.
 * - 숫자와 점 하나만 받는다
 * - 소수 4자리를 넘기면 무시한다 (자르지 않는다)
 * - "90." 처럼 입력 중인 값은 텍스트로만 남기고 부모에 넘기지 않는다
 */
export function nextRateText(raw: string): RateEdit {
  if (raw === '') return { kind: 'accept', text: '', value: undefined };
  if (!/^[0-9]*\.?[0-9]*$/.test(raw)) return { kind: 'reject' };
  const dot = raw.indexOf('.');
  if (dot !== -1 && raw.length - dot - 1 > MAX_DECIMALS) return { kind: 'reject' };
  const n = parseFloat(raw);
  const pending = raw.endsWith('.') || !Number.isFinite(n);
  return { kind: 'accept', text: raw, value: pending ? undefined : n };
}

/** 포커스가 빠질 때의 정리 — 표기만 다듬고 값은 바꾸지 않는다 */
export function commitRateText(text: string): { text: string; value: number | undefined } {
  const n = parseFloat(text);
  if (!Number.isFinite(n)) return { text: '', value: undefined };
  return { text: String(n), value: n };
}
