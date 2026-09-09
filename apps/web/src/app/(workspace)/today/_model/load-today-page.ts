/** @module 책임: 오늘 route의 URL 조건 검증·목록 조회·사라진 cursor의 한 번 재조회 분기와 표시 변환의 조립 순서를 소유한다. */
import {
  openAuctionListQuerySchema,
  type OpenAuctionListV1Response
} from '@eatbid/contracts/api/v1/auctions';

import type { TodaySearch } from '../_lib/today-search-params';
import { presentOpenAuctionList, type OpenAuctionListPresentation } from './present-open-auctions';

export type TodayListInput = {
  readonly region?: string;
  readonly item?: string;
  readonly closesWithinHours?: number;
  readonly baseAmountMin?: string;
  readonly baseAmountMax?: string;
  readonly cursor?: string;
};

// 사라진 cursor는 예외가 아니라 결과다. 캐시된 server read가 예외의 class 정체성을 보존하지 못하므로
// 예상된 실패는 값으로 받는다(`api/auctions/server.ts`).
export type TodayListRead =
  | { readonly kind: 'page'; readonly response: OpenAuctionListV1Response }
  | { readonly kind: 'cursor-not-found' };

export type TodayPageDependencies = {
  readonly listOpenAuctions: (input: TodayListInput) => Promise<TodayListRead>;
  readonly now: () => string;
};

export type TodayPageData = {
  readonly nowIso: string;
  // URL에서 읽은 조건 가운데 계약이 받는 것만 남긴 값이다. 화면의 칩·링크는 이것을 기준으로 그린다.
  readonly search: TodaySearch;
  readonly presentation: OpenAuctionListPresentation;
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
    region: accepted(shape.region, search.region),
    item: accepted(shape.item, search.item),
    closesWithinHours: accepted(shape.closesWithinHours, search.closesWithinHours),
    baseAmountMin: accepted(shape.baseAmountMin, search.baseAmountMin),
    baseAmountMax: accepted(shape.baseAmountMax, search.baseAmountMax),
    cursor: accepted(shape.cursor, search.cursor)
  };
}

function listInput(search: TodaySearch): TodayListInput {
  return {
    region: search.region ?? undefined,
    item: search.item ?? undefined,
    closesWithinHours: search.closesWithinHours ?? undefined,
    baseAmountMin: search.baseAmountMin ?? undefined,
    baseAmountMax: search.baseAmountMax ?? undefined,
    cursor: search.cursor ?? undefined
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
  const first = await dependencies.listOpenAuctions(listInput(search));
  if (first.kind === 'page') {
    return { nowIso, search, presentation: presentOpenAuctionList(first.response, nowIso), cursorReset: false };
  }
  // cursor 없는 조회가 cursor 오류로 답하면 계약이 깨진 것이다. 빈 목록으로 위장하지 않는다.
  if (search.cursor === null) throw new TodayCursorStillInvalid();
  const reset = { ...search, cursor: null };
  const second = await dependencies.listOpenAuctions(listInput(reset));
  if (second.kind !== 'page') throw new TodayCursorStillInvalid();
  return { nowIso, search: reset, presentation: presentOpenAuctionList(second.response, nowIso), cursorReset: true };
}
