/** @module 책임: 쉼표로 이어진 원천 품목 라벨을 좁은 폭에서 접는 표시 규칙을 오늘 표와 결정 화면 헤더가 함께 쓰도록 한 곳에서 소유한다. */

export type ItemLabelSummary = {
  readonly text: string;
  readonly full: string | null;
  /** 쉼표로 나눈 조각들이다. 품목이 하나면 길이 1이고 라벨과 같다. */
  readonly parts: readonly string[];
};

/**
 * 원천 품목 라벨은 "농산물 , 수산물 , …"처럼 쉼표로 이어진 여러 품목일 수 있다. 셀이나 칩 하나가 그 전체를
 * nowrap으로 품으면 좁은 폭에서 표가 카드를 넘기므로 첫 품목과 나머지 개수로 접는다. 품목이 하나면 라벨을
 * 그대로 두고 full은 비운다.
 *
 * **조각은 필터 값으로 쓴다.** 조인 키·코호트 키로는 여전히 쓰지 않는다(AGENTS 2). 완전일치로 거르면 절반을
 * 놓치기 때문이다 — 합성 라벨 한 칸에 `육류 , 가금류`가 함께 들어 있어 `육류`로 물으면 그 행이 안 걸린다
 * (2026-09-14 dev 실측: 열린 404행 중 98행이 합성). 품목 code scheme이 생기면 이 축은 코드로 옮겨 간다(EAT-66).
 */
export function summarizeItemLabel(label: string): ItemLabelSummary {
  const parts = label
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length <= 1) return { text: label, full: null, parts: parts.length === 0 ? [label] : parts };
  return { text: `${parts[0]} 외 ${parts.length - 1}`, full: parts.join(', '), parts };
}
