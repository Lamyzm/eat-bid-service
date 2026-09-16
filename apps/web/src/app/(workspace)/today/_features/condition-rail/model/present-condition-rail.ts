/** @module 책임: 요약의 배지 수와 주소의 조건을 합쳐 조건 기둥 세 구역(지역·품목·기초금액)이 그릴 줄과 링크를 만든다. 토글 규칙·문구·순서가 여기 있고 UI는 받은 줄을 그리기만 한다. */
import { AUCTION_ITEM_ATOMS } from '@eatbid/contracts/api/v1/auctions';

import { wonText } from '@/app/(workspace)/today/_lib/describe-today-search';
import {
  ALL_REGIONS_SCOPE,
  buildTodayFilterRoute,
  todaySearchParsers,
  type TodayRoute,
  type TodaySearch
} from '@/app/(workspace)/today/_lib/today-search-params';
import type { TodayRegionGate } from '@/app/(workspace)/today/_model/load-today-page';
import type { OpenSummaryPresentation } from '@/app/(workspace)/today/_model/present-open-summary';

/**
 * 기둥의 줄 하나다. `href`가 null이면 누를 것이 없는 사실 표시다 — 지역 미상은 걸 조건이 없고, 품목 축이
 * 없을 때의 품목 미상은 이미 보고 있다. `countText`가 빈 문자열이면 못 센 것이지 0이 아니다(AGENTS 3).
 */
export type RailRow = {
  readonly key: string;
  readonly label: string;
  readonly countText: string;
  readonly active: boolean;
  readonly href: TodayRoute | null;
};

export type ConditionRailPresentation = {
  readonly region: {
    /** 시도 고르기의 현재 값이다. 안 골랐으면 `전체`다. */
    readonly sidoText: string;
    readonly sidoRows: readonly RailRow[];
    readonly sigunguRows: readonly RailRow[];
    readonly unobservedText: string | null;
    /**
     * 참가제한지역 게이트다. 공고지역과 다른 축이라 체크 목록이 아니라 한 줄 사실과 출구 둘로 남긴다 —
     * 이것은 필터이지 자격 판정이 아니다(ADR 0048 결정 5).
     */
    readonly gate: { readonly text: string; readonly links: readonly { readonly label: string; readonly href: string }[] } | null;
  };
  readonly item: {
    readonly rows: readonly RailRow[];
    readonly unknownRow: RailRow;
  };
  readonly amount: {
    /** 입력 칸의 현재 값(천 단위)이다. 비어 있으면 `하한 없음`이 placeholder로 선다. */
    readonly valueText: string;
    /** 금액만 바꿔도 나머지 조건이 풀리지 않게 GET form이 함께 보낼 값들이다. cursor는 뺀다. */
    readonly carried: readonly { readonly key: string; readonly value: string }[];
    readonly clearHref: TodayRoute | null;
  };
};

/** 라벨이 관측되지 않은 코드는 지어낸 이름 대신 코드 문자열로 부른다. */
function regionText(region: { readonly code: string; readonly label: string | null }): string {
  return region.label ?? `코드 ${region.code}`;
}

function countText(count: number | null): string {
  return count === null ? '' : String(count);
}

function toggled(values: readonly string[] | null, value: string): string[] | null {
  const current = values ?? [];
  const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
  return next.length === 0 ? null : next;
}

function regionSection(
  search: TodaySearch,
  counts: OpenSummaryPresentation['railCounts'] | null,
  gate: TodayRegionGate
): ConditionRailPresentation['region'] {
  const sidoRows: RailRow[] = [
    { key: 'all', label: '전체', countText: '', active: search.sido === null, href: buildTodayFilterRoute(search, { sido: null, sigungu: null }) },
    ...(counts?.sidoCounts ?? []).map((entry) => ({
      key: entry.region.codeValueId,
      label: regionText(entry.region),
      countText: countText(entry.count),
      active: search.sido === entry.region.codeValueId,
      // 시도를 바꾸면 시군구는 뜻을 잃으므로 함께 지운다.
      href: buildTodayFilterRoute(search, { sido: entry.region.codeValueId, sigungu: null })
    }))
  ];
  const selectedSido = sidoRows.find((row) => row.active && row.key !== 'all');
  return {
    sidoText: selectedSido?.label ?? '전체',
    sidoRows,
    sigunguRows: (counts?.sigunguCounts ?? []).map((entry) => ({
      key: entry.region.codeValueId,
      label: regionText(entry.region),
      countText: countText(entry.count),
      active: search.sigungu?.includes(entry.region.codeValueId) ?? false,
      href: buildTodayFilterRoute(search, { sigungu: toggled(search.sigungu, entry.region.codeValueId) })
    })),
    // 지역 미상은 걸 조건이 없는 사실이다. 0이면 말하지 않는다 — 없는 결손을 적으면 다른 수 사이에서 무게를 갖는다.
    unobservedText: counts === null || counts.regionUnobservedCount === 0 ? null : `지역 미상 ${counts.regionUnobservedCount}`,
    gate: gateOf(search, gate)
  };
}

function gateOf(search: TodaySearch, gate: TodayRegionGate): ConditionRailPresentation['region']['gate'] {
  if (gate.kind === 'unknown' || gate.kind === 'unset') return null;
  const areas = gate.areas.map(regionText);
  const change = { label: '지역 바꾸기', href: '/setup?return=%2Ftoday' };
  if (gate.kind === 'all-regions') {
    return { text: '전국 공고', links: [{ label: '내 지역만 보기', href: buildTodayFilterRoute(search, { scope: null }) }, change] };
  }
  return {
    text: areas.length === 0 ? '내가 고른 지역의 공고 · 고른 지역 없음' : `내가 고른 지역의 공고 · ${areas.join(' · ')}`,
    links: [{ label: '전체 보기', href: buildTodayFilterRoute(search, { scope: ALL_REGIONS_SCOPE }) }, change]
  };
}

function itemSection(search: TodaySearch, counts: OpenSummaryPresentation['railCounts'] | null): ConditionRailPresentation['item'] {
  const countOf = new Map((counts?.itemCounts ?? []).map((entry) => [entry.item, entry.count]));
  const rows = AUCTION_ITEM_ATOMS.map((atom) => ({
    key: atom,
    label: atom,
    countText: countText(countOf.get(atom) ?? null),
    active: search.items?.includes(atom) ?? false,
    href: buildTodayFilterRoute(search, { items: toggled(search.items, atom) })
  }));
  // 품목 미상 포함은 품목 축이 걸렸을 때만 일한다. 축이 없으면 이미 전부 보고 있어 누를 것이 없다.
  const includeUnknown = search.itemUnknown === 'include';
  return {
    rows,
    unknownRow: {
      key: 'unknown',
      label: '품목 미상',
      countText: countText(counts?.itemUnobservedCount ?? null),
      active: search.items !== null && includeUnknown,
      href: search.items === null ? null : buildTodayFilterRoute(search, { itemUnknown: includeUnknown ? null : 'include' })
    }
  };
}

function amountSection(search: TodaySearch): ConditionRailPresentation['amount'] {
  const carried = (Object.keys(todaySearchParsers) as (keyof TodaySearch)[])
    .filter((key) => key !== 'baseAmountMin' && key !== 'baseAmountMax' && key !== 'cursor')
    .flatMap((key) => {
      const value = search[key];
      return value === null ? [] : [{ key, value: String(value) }];
    });
  return {
    valueText: search.baseAmountMin === null ? '' : wonText(search.baseAmountMin),
    carried,
    clearHref: search.baseAmountMin === null && search.baseAmountMax === null
      ? null
      : buildTodayFilterRoute(search, { baseAmountMin: null, baseAmountMax: null })
  };
}

export function presentConditionRail(input: {
  readonly search: TodaySearch;
  readonly summary: OpenSummaryPresentation | null;
  readonly gate: TodayRegionGate;
}): ConditionRailPresentation {
  const counts = input.summary?.railCounts ?? null;
  return {
    region: regionSection(input.search, counts, input.gate),
    item: itemSection(input.search, counts),
    amount: amountSection(input.search)
  };
}
