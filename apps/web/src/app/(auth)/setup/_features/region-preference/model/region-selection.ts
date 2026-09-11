/**
 * @module 책임: 지역 선택의 켜고 끄기 규칙과 고른 목록의 표시 순서를 소유한다. 저장에 나가는 값은
 * 사용자가 최종적으로 남긴 code value id 집합 하나뿐이다.
 */
import type { EligibilityArea, EligibilityAreaGroup } from '@/api/eligibility-areas';

export type RegionSelection = ReadonlySet<string>;

/**
 * 시군구를 켜면 그 시도의 `전체`가 함께 켜진다.
 *
 * 도 전체로 열린 공고는 그 시 업체도 낼 수 있다. 안 켜면 낼 수 있는 공고가 목록에서 사라지고, 그것을
 * 사장님이 알아서 챙기게 두는 것이 설계 실수다 — 실측에서 김해시만 두면 2건, 경남 전체까지 있으면 9건이
 * 잡혔다. 다만 조용히 하지 않는다. 함께 켜진 `전체`도 고른 목록에 그대로 보이고 사용자가 그것만 뺄 수
 * 있으며, 뺀 상태가 그대로 저장되고 조회에도 반영된다.
 *
 * 그래서 "자동으로 켰다"는 상태를 남기지 않는다. 저장되는 것은 코드 목록뿐이고, 이 함수는 그 목록을
 * 만드는 입력 보조일 뿐이다(ADR 0048 결정 2).
 */
export function toggleArea(
  selection: RegionSelection,
  group: EligibilityAreaGroup,
  codeValueId: string
): RegionSelection {
  const next = new Set(selection);
  if (next.has(codeValueId)) {
    // 끄기는 켜기와 대칭이 아니다. `전체`를 끄는 것은 사용자의 명시적 선택이므로 시군구를 함께 끄지 않고,
    // 시군구를 끄는 것도 `전체`를 건드리지 않는다.
    next.delete(codeValueId);
    return next;
  }
  next.add(codeValueId);
  if (codeValueId !== group.all.codeValueId) next.add(group.all.codeValueId);
  return next;
}

/** 고른 목록의 × 버튼이다. 어느 칸에서 켜졌든 하나만 뺀다. */
export function removeArea(selection: RegionSelection, codeValueId: string): RegionSelection {
  const next = new Set(selection);
  next.delete(codeValueId);
  return next;
}

/**
 * 고른 목록의 표시 순서다. 코드 순으로 정렬해 같은 선택이 언제나 같은 줄로 보이게 한다. 정렬 키가
 * 코드인 이유는 라벨이 관측되지 않은 코드도 자리를 갖기 때문이다(AGENTS 3).
 */
export function selectedAreas(
  groups: readonly EligibilityAreaGroup[],
  selection: RegionSelection
): readonly EligibilityArea[] {
  return groups
    .flatMap((group) => [group.all, ...group.parts])
    .filter((area) => selection.has(area.codeValueId))
    .toSorted((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
}

/** 시도 묶음 하나에서 몇 개를 골랐는지다. 접힌 줄이 "3 / 19"를 말할 수 있어야 한다. */
export function groupSelectedCount(group: EligibilityAreaGroup, selection: RegionSelection): number {
  return [group.all, ...group.parts].filter((area) => selection.has(area.codeValueId)).length;
}

export function groupAreaCount(group: EligibilityAreaGroup): number {
  return group.parts.length + 1;
}

/** 라벨이 관측되지 않은 코드는 지어낸 이름 대신 코드 문자열로 부른다. */
export function areaText(area: EligibilityArea): string {
  return area.label ?? `코드 ${area.code}`;
}

/** 저장 command에 나가는 값이다. 순서는 뜻이 없지만 같은 선택이 같은 요청이 되도록 코드 순으로 낸다. */
export function selectionToCodeValueIds(
  groups: readonly EligibilityAreaGroup[],
  selection: RegionSelection
): readonly string[] {
  return selectedAreas(groups, selection).map((area) => area.codeValueId);
}

/** 저장된 목록과 지금 선택이 같은지. 다르면 저장 버튼이 살아난다. */
export function sameSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const known = new Set(left);
  return right.every((value) => known.has(value));
}
