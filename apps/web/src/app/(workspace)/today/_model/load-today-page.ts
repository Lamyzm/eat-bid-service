/** @module 책임: 오늘 route의 URL 조건 검증·목록 조회·사라진 cursor의 한 번 재조회 분기와 표시 변환의 조립 순서를 소유한다. */
import {
  MAX_OPEN_AUCTION_LIMIT,
  openAuctionListQuerySchema,
  type OpenAuctionListV1Response,
  type OpenAuctionSummaryV1Response
} from '@eatbid/contracts/api/v1/auctions';
import {
  maxFilterCombinations,
  type MyFilterCombinationCountsV1Response,
  type MyFilterCombinationsV1Response
} from '@eatbid/contracts/api/v1/me';

import { ALL_REGIONS_SCOPE, normalizeAmountInput, type TodaySearch } from '../_lib/today-search-params';
import { presentOpenAuctionList, type OpenAuctionListPresentation } from './present-open-auctions';
import { presentCombinations, type CombinationsPresentation } from './present-combinations';
import {
  calendarWindow,
  kstToday,
  presentOpenSummary,
  type OpenSummaryPresentation
} from './present-open-summary';

export type TodayListInput = {
  readonly sido?: string;
  readonly eligibilityArea?: readonly string[];
  readonly items?: readonly string[];
  readonly itemUnknown?: 'include';
  readonly bidState?: 'none';
  readonly closesWithinHours?: number;
  readonly closesOn?: string;
  readonly announcedOn?: string;
  readonly baseAmountMin?: string;
  readonly baseAmountMax?: string;
  readonly cursor?: string;
  readonly limit?: number;
};

/**
 * 요약 입력은 목록과 필터 atom을 공유하되 날짜 축과 cursor가 없다. 탭이 세는 수는 **탭을 누르기 전에도**
 * 보여야 하므로, 지금 고른 날짜로 요약까지 좁히면 `오늘 마감` 탭에서 `진행중` 수가 자기 자신이 된다.
 */
export type TodaySummaryInput = {
  readonly sido?: string;
  readonly eligibilityArea?: readonly string[];
  readonly items?: readonly string[];
  readonly baseAmountMin?: string;
  readonly baseAmountMax?: string;
  readonly calendarFrom: string;
  readonly calendarTo: string;
};

// 사라진 cursor는 예외가 아니라 결과다. 캐시된 server read가 예외의 class 정체성을 보존하지 못하므로
// 예상된 실패는 값으로 받는다(`api/auctions/server.ts`).
export type TodayListRead =
  | { readonly kind: 'page'; readonly response: OpenAuctionListV1Response }
  | { readonly kind: 'cursor-not-found' };

/**
 * 워크스페이스가 확인한 관심 지역이다. `confirmedAt`이 null이면 아직 묻지 않은 것이고, 확인했는데
 * 목록이 비어 있으면 "지역으로 좁히지 않겠다"는 사용자의 선택이다. 셋을 한 값으로 합치면 화면이
 * 설정 요청과 전국 목록을 구분하지 못한다.
 */
export type TodayRegionPreference = {
  readonly areas: ReadonlyArray<{ readonly codeValueId: string; readonly code: string; readonly label: string | null }>;
  readonly confirmedAt: string | null;
};

/**
 * 조합은 목록의 전제가 아니라 탐색을 빠르게 하는 기둥이다. 못 읽으면 기둥만 비우고 목록은 그대로 낸다 —
 * 실패를 빈 목록으로 바꾸면 화면이 "저장한 조합이 없다"고 거짓말한다.
 */
export type TodayCombinationsRead = {
  readonly combinations: MyFilterCombinationsV1Response['combinations'];
  readonly counts: MyFilterCombinationCountsV1Response | null;
};

export type TodayPageDependencies = {
  readonly listOpenAuctions: (input: TodayListInput) => Promise<TodayListRead>;
  readonly summarizeOpenAuctions: (input: TodaySummaryInput) => Promise<OpenAuctionSummaryV1Response>;
  /** 조합을 읽지 못한 배포에서도 화면이 서야 하므로 선택 의존이다. */
  readonly readCombinations?: (input: TodaySummaryInput) => Promise<TodayCombinationsRead | null>;
  readonly now: () => string;
  /** 서버가 읽지 못했으면 undefined다. 그때는 좁힐 근거가 없으므로 목록을 그대로 보여 준다. */
  readonly regionPreference?: TodayRegionPreference;
};

/**
 * 목록 자리에 무엇을 그릴지의 첫 갈림길이다. 지역을 아직 확인하지 않은 워크스페이스에는 목록 대신
 * 설정을 요청한다 — 전국 404건을 그대로 쏟아 놓는 것이 이 화면이 하지 않기로 한 일이다.
 */
export type TodayRegionGate =
  | { readonly kind: 'unset' }
  | { readonly kind: 'applied'; readonly areas: TodayRegionPreference['areas'] }
  | { readonly kind: 'all-regions'; readonly areas: TodayRegionPreference['areas'] }
  | { readonly kind: 'unknown' };

export type TodayPageData = {
  readonly nowIso: string;
  readonly regionGate: TodayRegionGate;
  // URL에서 읽은 조건 가운데 계약이 받는 것만 남긴 값이다. 화면의 칩·링크는 이것을 기준으로 그린다.
  readonly search: TodaySearch;
  // 지역 미설정이면 목록을 조회하지 않으므로 표시 모델 자체가 없다.
  readonly presentation: OpenAuctionListPresentation | null;
  // 탭·달력·축 줄의 재료다. 목록과 같은 이유로 지역 미설정이면 없다.
  readonly summary: OpenSummaryPresentation | null;
  // 왼쪽 기둥의 재료다. 못 읽었으면 null이고 그때 기둥은 조합 자리를 비운다.
  readonly combinations: CombinationsPresentation | null;
  // build 전환으로 cursor가 사라져 처음부터 다시 조회했다는 사실. 화면이 그 사실을 한 줄로 말한다.
  readonly cursorReset: boolean;
};

const shape = openAuctionListQuerySchema.shape;

function accepted<Value>(schema: { safeParse(value: unknown): { success: boolean } }, value: Value | null): Value | null {
  return value !== null && schema.safeParse(value).success ? value : null;
}

/**
 * URL에 남은 잘못된 값은 계약 schema의 같은 필드로 걸러 null로 다룬다. 값이 하나 틀렸다고 화면 전체를
 * 400으로 보내지 않고, 네트워크 호출 전에 무효 요청을 없앤다.
 */
export function normalizeTodaySearch(search: TodaySearch): TodaySearch {
  return {
    // `scope`는 계약이 받는 값이 아니라 화면이 저장된 설정을 이번 조회에 걸지 말지를 정하는 스위치다.
    scope: search.scope,
    sido: accepted(shape.sido, search.sido),
    items: accepted(shape.items, search.items),
    itemUnknown: accepted(shape.itemUnknown, search.itemUnknown),
    bidState: accepted(shape.bidState, search.bidState),
    // 계약이 시간 창과 달력일을 함께 받지 않는다. 달력일이 있으면 시간 창을 버린다 — 탭·달력이 시간
    // 창보다 뒤에 눌린 조건이고, 둘을 함께 보내면 서버가 400으로 답해 화면 전체가 오류가 된다.
    closesWithinHours: search.closesOn === null ? accepted(shape.closesWithinHours, search.closesWithinHours) : null,
    closesOn: accepted(shape.closesOn, search.closesOn),
    announcedOn: accepted(shape.announcedOn, search.announcedOn),
    baseAmountMin: accepted(shape.baseAmountMin, normalizeAmountInput(search.baseAmountMin)),
    baseAmountMax: accepted(shape.baseAmountMax, normalizeAmountInput(search.baseAmountMax)),
    cursor: accepted(shape.cursor, search.cursor)
  };
}

function regionGateOf(search: TodaySearch, preference: TodayRegionPreference | undefined): TodayRegionGate {
  if (preference === undefined) return { kind: 'unknown' };
  if (preference.confirmedAt === null) return { kind: 'unset' };
  if (search.scope === ALL_REGIONS_SCOPE) return { kind: 'all-regions', areas: preference.areas };
  return { kind: 'applied', areas: preference.areas };
}

function eligibilityAreaOf(gate: TodayRegionGate): readonly string[] | undefined {
  // 확인했는데 고른 지역이 없는 상태도 필터를 건다. 그래야 "제한지역 미관측"만 남는 결과가 전국 목록과
  // 다른 사실로 화면에 닿는다.
  return gate.kind === 'applied' ? gate.areas.map((area) => area.codeValueId) : undefined;
}

function listInput(search: TodaySearch, gate: TodayRegionGate): TodayListInput {
  return {
    sido: search.sido ?? undefined,
    eligibilityArea: eligibilityAreaOf(gate),
    items: search.items ?? undefined,
    itemUnknown: search.itemUnknown === 'include' ? 'include' : undefined,
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

function summaryInput(search: TodaySearch, gate: TodayRegionGate, nowIso: string): TodaySummaryInput {
  const window = calendarWindow(nowIso);
  return {
    sido: search.sido ?? undefined,
    eligibilityArea: eligibilityAreaOf(gate),
    items: search.items ?? undefined,
    baseAmountMin: search.baseAmountMin ?? undefined,
    baseAmountMax: search.baseAmountMax ?? undefined,
    calendarFrom: window.from,
    calendarTo: window.to
  };
}

class TodayCursorStillInvalid extends Error {
  readonly name = 'TodayCursorStillInvalid';

  constructor() {
    super('cursor 없는 조회가 cursor 오류로 답했습니다.');
  }
}

/**
 * route 제어 흐름을 순수하게 검증할 수 있도록 서버 I/O와 현재 시각을 주입받는다. cursor가 활성 build에
 * 없다는 결과는 잘못된 요청이 아니라 목록이 갱신됐다는 뜻이라 cursor 없이 한 번만 다시 조회한다.
 * 그 밖의 실패는 그대로 올려 route error 경계가 받는다.
 */
export async function loadTodayPage(rawSearch: TodaySearch, dependencies: TodayPageDependencies): Promise<TodayPageData> {
  const nowIso = dependencies.now();
  const search = normalizeTodaySearch(rawSearch);
  const regionGate = regionGateOf(search, dependencies.regionPreference);
  // 지역 미설정이면 목록을 아예 부르지 않는다. 화면이 그리지 않을 전국 목록을 받아 오는 것은 낭비이고,
  // 받아 둔 값이 있으면 다음 사람이 그것을 그리고 싶어진다.
  if (regionGate.kind === 'unset') {
    return {
      nowIso, regionGate, search, presentation: null, summary: null, combinations: null, cursorReset: false
    };
  }
  // 둘을 나란히 부른다. 요약은 목록의 페이지가 아니라 조건 전체를 세므로 앞의 결과를 기다릴 이유가 없고,
  // 순서대로 부르면 한 화면이 두 왕복 시간을 그대로 더한다.
  const [first, summaryResponse, combinationsRead] = await Promise.all([
    dependencies.listOpenAuctions(listInput(search, regionGate)),
    dependencies.summarizeOpenAuctions(summaryInput(search, regionGate, nowIso)),
    dependencies.readCombinations?.(summaryInput(search, regionGate, nowIso)) ?? Promise.resolve(null)
  ]);
  const summary = presentOpenSummary(summaryResponse, nowIso, search);
  const combinations = combinationsRead === null ? null : presentCombinations({
    combinations: combinationsRead.combinations,
    counts: combinationsRead.counts,
    search,
    today: kstToday(nowIso).toString(),
    savedLimit: maxFilterCombinations
  });
  if (first.kind === 'page') {
    return {
      nowIso,
      regionGate,
      search,
      presentation: presentOpenAuctionList(first.response, nowIso),
      summary,
      combinations,
      cursorReset: false
    };
  }
  // cursor 없는 조회가 cursor 오류로 답하면 계약이 깨진 것이다. 빈 목록으로 위장하지 않는다.
  if (search.cursor === null) throw new TodayCursorStillInvalid();
  const reset = { ...search, cursor: null };
  const second = await dependencies.listOpenAuctions(listInput(reset, regionGate));
  if (second.kind !== 'page') throw new TodayCursorStillInvalid();
  // 요약은 cursor를 받지 않으므로 다시 부르지 않는다. 같은 조건을 두 번 세는 일이 없다.
  return {
    nowIso,
    regionGate,
    search: reset,
    presentation: presentOpenAuctionList(second.response, nowIso),
    summary,
    combinations,
    cursorReset: true
  };
}
