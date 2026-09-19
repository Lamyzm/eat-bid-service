/** @module 책임: 화면 조건과 지역 게이트에서 목록·요약 조회가 받을 입력을 만든다. 게이트를 언제 거는지의 규칙을 여기 하나가 소유한다. */
import { MAX_OPEN_AUCTION_LIMIT } from '@eatbid/contracts/api/v1/auctions';

import { ALL_REGIONS_SCOPE, type TodaySearch } from '../_lib/today-search-params';
import { calendarWindow } from './present-open-summary';
import type {
  TodayListInput,
  TodayRegionGate,
  TodayRegionPreference,
  TodaySummaryInput
} from './load-today-page';

export function regionGateOf(search: TodaySearch, preference: TodayRegionPreference | undefined): TodayRegionGate {
  if (preference === undefined) return { kind: 'unknown' };
  if (preference.confirmedAt === null) return { kind: 'unset' };
  if (search.scope === ALL_REGIONS_SCOPE) return { kind: 'all-regions', areas: preference.areas };
  return { kind: 'applied', areas: preference.areas };
}

/**
 * 조합 이름에 쓸 지역 라벨이다. **고른 지역이 하나일 때만 이름이 있다** — 둘 이상이면 어느 것으로
 * 불러도 나머지를 숨기게 되므로 이름을 만들지 않고 화면이 `내 지역`으로 물러선다. 라벨을 관측하지
 * 못한 지역(EAT-100)도 이름이 없다.
 */
export function regionTextOf(gate: TodayRegionGate): string | null {
  if (gate.kind !== 'applied' || gate.areas.length !== 1) return null;
  return gate.areas[0]!.label;
}

function eligibilityAreaOf(gate: TodayRegionGate, search: TodaySearch): readonly string[] | undefined {
  // 지역 축(공고지역)을 직접 골랐으면 게이트(참가제한지역)를 걸지 않는다. 둘은 다른 체계이고(AGENTS 6) 지역
  // 필터는 게이트와 독립으로 동작한다(사용자 결정 2026-09-17, EAT-260) — 경남을 골랐는데 서울 게이트가 남아
  // 있으면 "경남에 김해밖에 없다"는 거짓 목록이 된다.
  if (search.sido !== null) return undefined;
  // 확인했는데 고른 지역이 없는 상태도 필터를 건다. 그래야 "제한지역 미관측"만 남는 결과가 전국 목록과
  // 다른 사실로 화면에 닿는다.
  return gate.kind === 'applied' ? gate.areas.map((area) => area.codeValueId) : undefined;
}

export function listInput(search: TodaySearch, gate: TodayRegionGate): TodayListInput {
  return {
    sido: search.sido ?? undefined,
    sigungu: search.sigungu ?? undefined,
    regionUnknown: search.regionUnknown === null ? undefined : 'include',
    eligibilityArea: eligibilityAreaOf(gate, search),
    items: search.items ?? undefined,
    itemUnknown: search.itemUnknown === 'include' ? 'include' : undefined,
    q: search.q ?? undefined,
    bidState: search.bidState === 'none' ? 'none' : undefined,
    closesWithinHours: search.closesWithinHours ?? undefined,
    closesOn: search.closesOn ?? undefined,
    announcedOn: search.announcedOn ?? undefined,
    baseAmountMin: search.baseAmountMin ?? undefined,
    baseAmountMax: search.baseAmountMax ?? undefined,
    cursor: search.cursor ?? undefined,
    /**
     * 화면은 언제나 상한만큼 요청한다. 더보기를 두지 않기로 했으므로(사용자 결정) 페이지를 나누면 못 보는
     * 행이 생기고 그 사실이 화면에 안 남는다. 넘치면 목록이 `N건 중 200건`이라고 적고, 좁히는 길 셋
     * (달력 칸·지역 칩·검색)이 이미 화면에 있다.
     *
     * 근거는 성수기 실측이다. 사용자의 기본 조건(김해 축산)이 06-19 성수기에 62행이라 한 판에 들어간다.
     */
    limit: MAX_OPEN_AUCTION_LIMIT
  };
}

export function summaryInput(search: TodaySearch, gate: TodayRegionGate, nowIso: string): TodaySummaryInput {
  const window = calendarWindow(nowIso);
  return {
    sido: search.sido ?? undefined,
    sigungu: search.sigungu ?? undefined,
    regionUnknown: search.regionUnknown === null ? undefined : 'include',
    eligibilityArea: eligibilityAreaOf(gate, search),
    items: search.items ?? undefined,
    itemUnknown: search.itemUnknown === 'include' ? 'include' : undefined,
    q: search.q ?? undefined,
    baseAmountMin: search.baseAmountMin ?? undefined,
    baseAmountMax: search.baseAmountMax ?? undefined,
    calendarFrom: window.from,
    calendarTo: window.to
  };
}
