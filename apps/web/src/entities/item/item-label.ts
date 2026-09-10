/** @module 책임: 쉼표로 이어진 원천 품목 라벨을 좁은 폭에서 접는 표시 규칙을 오늘 표와 결정 화면 헤더가 함께 쓰도록 한 곳에서 소유한다. */

export type ItemLabelSummary = { readonly text: string; readonly full: string | null };

/**
 * 원천 품목 라벨은 "농산물 , 수산물 , …"처럼 쉼표로 이어진 여러 품목일 수 있다. 셀이나 칩 하나가 그 전체를
 * nowrap으로 품으면 좁은 폭에서 표가 카드를 넘기므로 첫 품목과 나머지 개수로 접는다. 여기서 나눈 조각은
 * 표시에만 쓰고 필터 링크·코호트·조인 키로 되살리지 않는다(AGENTS 2·15). 품목이 하나면 라벨을 그대로 두고
 * full은 비운다.
 */
export function summarizeItemLabel(label: string): ItemLabelSummary {
  const parts = label
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length <= 1) return { text: label, full: null };
  return { text: `${parts[0]} 외 ${parts.length - 1}`, full: parts.join(', ') };
}
