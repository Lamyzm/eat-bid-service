/** @module 책임: 조건 값을 짧은 글로 옮기는 규칙을 한 곳에 두어 여닫이 요약과 맥락 문장이 같은 말을 쓰게 한다. */
import type { AnalysisFilterValue } from '@eatbid/contracts/api/v1/analysis';

/**
 * 소수 자리의 0은 값을 바꾸지 않으면서 폭만 먹는다. `88.000%`는 `88%`보다 28px 넓고, 조건이 여섯 개인
 * 줄에서 그 28px이 마지막 칸을 다음 줄로 민다. 유효숫자는 지우지 않으므로 `87.745%`는 그대로 남는다.
 */
export function floorText(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * 고른 품목을 여닫이 한 줄로 줄인다. 칩을 여닫이 안에 담으면 고를수록 칸이 넓어지고, 그 폭이 조건
 * 줄을 밀어 품목 칸만 다음 줄로 떨어진다(2026-09-18 실측). 고른 것 전부는 펼친 목록의 체크가 말하고
 * 여닫이는 **폭이 변하지 않는 요약**만 맡는다.
 */
export function itemSelectionText(selected: readonly string[]): string {
  if (selected.length === 0) return '전체';
  return selected.length === 1 ? selected[0]! : `${selected[0]!} 외 ${selected.length - 1}`;
}

/**
 * 조건 막대를 접은 폭에서는 맥락 문장이 걸린 조건을 대신 말한다. 기본값은 적지 않는다 — 전부 적으면
 * 문장이 두 줄이 되고, 그러면 무엇을 **건드렸는지**가 안 보인다. 반대로 건드린 조건을 빠뜨리면 걸린
 * 줄 모른 채 숫자를 읽게 되므로 기본값이 아닌 것은 반드시 적는다(2026-09-18 디자인 심사).
 */
export function appliedItemText(itemFilter: AnalysisFilterValue['itemFilter']): string | null {
  if (itemFilter.kind === 'all') return null;
  if (itemFilter.kind === 'unknown') return '품목 미확인만';
  const named = itemSelectionText(itemFilter.atoms);
  return itemFilter.unknown ? `품목 ${named} · 미확인 포함` : `품목 ${named}`;
}

/** 겹쳐 찍은 기관은 조건이 아니라 표시 축이지만, 접힌 막대에서는 그림이 왜 달라 보이는지의 이유다. */
export function appliedOverlayText(overlayOrganizationIds: readonly string[]): string | null {
  if (overlayOrganizationIds.length === 0) return null;
  return `겹친 기관 ${overlayOrganizationIds.length}곳`;
}
