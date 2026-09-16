import { describe, expect, test } from 'bun:test';

import { fixtureNow, noSnapshotFixture, openAuctionsFixture, openSummaryFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import {
  loadTodayPage,
  normalizeTodaySearch,
  type TodayListInput,
  type TodayListRead,
  type TodayRegionPreference,
  type TodaySummaryInput
} from './load-today-page';

// 확인한 워크스페이스다. 목록을 좁히는 근거는 저장된 코드 값 id이고 라벨은 표시용 관측이다.
const confirmedPreference: TodayRegionPreference = {
  areas: [
    { codeValueId: '9101', code: '15000', label: '경남/전체' },
    { codeValueId: '9102', code: '15653', label: '경남/김해시' }
  ],
  confirmedAt: '2026-09-11T00:00:00Z'
};

const page: TodayListRead = { kind: 'page', response: openAuctionsFixture };
const staleCursor: TodayListRead = { kind: 'cursor-not-found' };

function dependencies(overrides: Partial<Parameters<typeof loadTodayPage>[1]> = {}) {
  const inputs: TodayListInput[] = [];
  const summaryInputs: TodaySummaryInput[] = [];
  return {
    inputs,
    summaryInputs,
    dependencies: {
      listOpenAuctions: async (input: TodayListInput) => {
        inputs.push(input);
        return page;
      },
      summarizeOpenAuctions: async (input: TodaySummaryInput) => {
        summaryInputs.push(input);
        return openSummaryFixture;
      },
      now: () => fixtureNow,
      regionPreference: confirmedPreference,
      ...overrides
    }
  };
}

describe('오늘 route loader', () => {
  test('URL에 남은 잘못된 값은 무시하고 계약이 받는 조건만 조회에 넘긴다', async () => {
    const { inputs, dependencies: deps } = dependencies();
    const data = await loadTodayPage(
      { scope: null, sido: '01', sigungu: null, regionUnknown: null, items: ['육류'], itemUnknown: null, q: null, bidState: null, closesWithinHours: 721, closesOn: null, announcedOn: null, baseAmountMin: '2000000', baseAmountMax: '3000000.00', cursor: 'abc' },
      deps
    );
    expect(inputs).toEqual([{
      sido: undefined,
      eligibilityArea: ['9101', '9102'],
      items: ['육류'],
      itemUnknown: undefined,
      bidState: undefined,
      closesWithinHours: undefined,
      closesOn: undefined,
      announcedOn: undefined,
      // `2000000`은 자릿수만 다른 값이라 버리지 않고 계약 형식으로 맞춰 보낸다.
      baseAmountMin: '2000000.00',
      baseAmountMax: '3000000.00',
      cursor: undefined,
      // 더보기를 두지 않으므로 화면은 언제나 상한만큼 요청한다. 페이지를 나누면 못 보는 행이 생기고
      // 그 사실이 화면에 안 남는다.
      limit: 200
    }]);
    expect(data.search).toEqual({
      scope: null, sido: null, sigungu: null, regionUnknown: null, items: ['육류'], itemUnknown: null, q: null, bidState: null,
      closesWithinHours: null, closesOn: null, announcedOn: null,
      baseAmountMin: '2000000.00', baseAmountMax: '3000000.00', cursor: null
    });
    expect(data.cursorReset).toBe(false);
    expect(data.presentation!.view.kind === 'list' ? data.presentation!.view.rows.length : 0).toBe(4);
  });

  test('검색어는 양끝 공백을 걷어 목록과 요약 둘 다에 넘기고 공백뿐이면 검색이 아니다', async () => {
    const { inputs, summaryInputs, dependencies: deps } = dependencies();
    const data = await loadTodayPage({ ...EMPTY_TODAY_SEARCH, q: '  남산  ' }, deps);
    expect(inputs[0]!.q).toBe('남산');
    // 요약이 검색을 안 받으면 검색 중에 탭·달력·배지가 검색 전 집합을 센다.
    expect(summaryInputs[0]!.q).toBe('남산');
    expect(data.search.q).toBe('남산');

    const { inputs: blankInputs, dependencies: blankDeps } = dependencies();
    const blank = await loadTodayPage({ ...EMPTY_TODAY_SEARCH, q: '   ' }, blankDeps);
    expect(blankInputs[0]!.q).toBeUndefined();
    expect(blank.search.q).toBeNull();
  });

  test('cursor가 무효면 cursor 없이 한 번만 다시 조회하고 그 사실을 남긴다', async () => {
    const calls: TodayListInput[] = [];
    const { dependencies: deps } = dependencies({
      listOpenAuctions: async (input) => {
        calls.push(input);
        return input.cursor === undefined ? page : staleCursor;
      }
    });
    const data = await loadTodayPage({ ...EMPTY_TODAY_SEARCH, cursor: '5796468' }, deps);
    expect(calls.map((call) => call.cursor)).toEqual(['5796468', undefined]);
    expect(data.cursorReset).toBe(true);
    expect(data.search.cursor).toBeNull();
  });

  test('조회가 실패하거나 cursor 없는 조회가 cursor 오류로 답하면 오류를 올린다', async () => {
    const { dependencies: failing } = dependencies({ listOpenAuctions: async () => { throw new Error('database offline'); } });
    await expect(loadTodayPage(EMPTY_TODAY_SEARCH, failing)).rejects.toThrow('database offline');
    let calls = 0;
    const { dependencies: twice } = dependencies({
      listOpenAuctions: async () => {
        calls += 1;
        return staleCursor;
      }
    });
    await expect(loadTodayPage({ ...EMPTY_TODAY_SEARCH, cursor: '5796468' }, twice)).rejects.toThrow('cursor 없는 조회가 cursor 오류로 답했습니다.');
    expect(calls).toBe(2);
    await expect(loadTodayPage(EMPTY_TODAY_SEARCH, twice)).rejects.toThrow('cursor 없는 조회가 cursor 오류로 답했습니다.');
  });

  test('활성 스냅샷 build가 없으면 계보 없음 상태다', async () => {
    const { dependencies: deps } = dependencies({ listOpenAuctions: async () => ({ kind: 'page', response: noSnapshotFixture }) });
    const data = await loadTodayPage(EMPTY_TODAY_SEARCH, deps);
    expect(data.presentation!.view).toEqual({ kind: 'no-snapshot' });
  });

  test('지역을 확인하지 않은 워크스페이스에는 목록을 아예 조회하지 않고 설정을 요청한다', async () => {
    const { inputs, dependencies: deps } = dependencies({
      regionPreference: { areas: [], confirmedAt: null }
    });
    const data = await loadTodayPage(EMPTY_TODAY_SEARCH, deps);
    expect(data.regionGate).toEqual({ kind: 'unset' });
    expect(data.presentation).toBeNull();
    // 화면이 그리지 않을 전국 목록을 받아 두지 않는다.
    expect(inputs).toEqual([]);
  });

  test('전체 보기는 저장된 설정을 지우지 않고 이번 조회에서만 필터를 뗀다', async () => {
    const { inputs, dependencies: deps } = dependencies();
    const data = await loadTodayPage({ ...EMPTY_TODAY_SEARCH, scope: 'all' }, deps);
    expect(data.regionGate).toEqual({ kind: 'all-regions', areas: confirmedPreference.areas });
    expect(inputs[0]!.eligibilityArea).toBeUndefined();
  });

  test('코드를 하나도 고르지 않은 확인도 필터를 걸어 미설정과 다른 결과를 낸다', async () => {
    const { inputs, dependencies: deps } = dependencies({
      regionPreference: { areas: [], confirmedAt: '2026-09-11T00:00:00Z' }
    });
    const data = await loadTodayPage(EMPTY_TODAY_SEARCH, deps);
    expect(data.regionGate).toEqual({ kind: 'applied', areas: [] });
    expect(inputs[0]!.eligibilityArea).toEqual([]);
  });

  test('설정을 읽지 못하면 좁힐 근거가 없으므로 목록을 그대로 보여 준다', async () => {
    const { inputs, dependencies: deps } = dependencies({ regionPreference: undefined });
    const data = await loadTodayPage(EMPTY_TODAY_SEARCH, deps);
    expect(data.regionGate).toEqual({ kind: 'unknown' });
    expect(inputs[0]!.eligibilityArea).toBeUndefined();
    expect(data.presentation).not.toBeNull();
  });

  test('정규화는 계약 schema의 같은 필드로 판정한다', () => {
    expect(normalizeTodaySearch({
      scope: null, sido: '9223372036854775807', sigungu: null, regionUnknown: null, items: ['x'.repeat(65)], itemUnknown: null, q: null, bidState: null,
      closesWithinHours: 0, closesOn: null, announcedOn: null, baseAmountMin: '1.00', baseAmountMax: null, cursor: '5'
    })).toEqual({
      scope: null, sido: '9223372036854775807', sigungu: null, regionUnknown: null, items: null, itemUnknown: null, q: null, bidState: null,
      closesWithinHours: null, closesOn: null, announcedOn: null,
      baseAmountMin: '1.00', baseAmountMax: null, cursor: '5'
    });
  });

  test('달력일을 고르면 시간 창을 버린다. 둘을 함께 보내면 계약이 400으로 답한다', () => {
    // 탭·달력이 시간 창보다 뒤에 눌린 조건이다. 서버가 거절할 요청을 화면이 아예 만들지 않는다.
    expect(normalizeTodaySearch({ ...EMPTY_TODAY_SEARCH, closesWithinHours: 72, closesOn: '2026-09-08' }))
      .toMatchObject({ closesWithinHours: null, closesOn: '2026-09-08' });
    // 게시일 축은 마감 축이 아니라 다른 축이라 계약이 시간 창과 함께 받는다.
    expect(normalizeTodaySearch({ ...EMPTY_TODAY_SEARCH, closesWithinHours: 72, announcedOn: '2026-09-07' }))
      .toMatchObject({ closesWithinHours: 72, announcedOn: '2026-09-07' });
  });

  test('요약은 목록과 나란히 한 번만 부르고 날짜 축과 cursor를 넘기지 않는다', async () => {
    const { summaryInputs, dependencies: deps } = dependencies();
    const data = await loadTodayPage({ ...EMPTY_TODAY_SEARCH, closesOn: '2026-09-08', items: ['육류'] }, deps);
    // 탭이 세는 수는 탭을 누르기 전에도 보여야 한다. 고른 날짜로 요약까지 좁히면 오늘 마감 탭에서
    // 진행중 수가 자기 자신이 된다.
    expect(summaryInputs).toEqual([{
      sido: undefined,
      eligibilityArea: ['9101', '9102'],
      items: ['육류'],
      baseAmountMin: undefined,
      baseAmountMax: undefined,
      // 기준일 2026-09-07은 월요일이라 창이 그날 시작해 열넷째 날에 끝난다.
      calendarFrom: '2026-09-07',
      calendarTo: '2026-09-20'
    }]);
    expect(data.summary!.tabs.map((tab) => [tab.id, tab.count, tab.active]))
      .toEqual([['live', 4, false], ['openedToday', null, false], ['closingToday', 1, false]]);
  });

  test('사라진 cursor로 목록을 다시 불러도 요약은 다시 부르지 않는다', async () => {
    const { summaryInputs, dependencies: deps } = dependencies({
      listOpenAuctions: async (input) => (input.cursor === undefined ? page : staleCursor)
    });
    const data = await loadTodayPage({ ...EMPTY_TODAY_SEARCH, cursor: '5796468' }, deps);
    // 요약은 cursor를 받지 않으므로 같은 조건을 두 번 셀 이유가 없다.
    expect(summaryInputs.length).toBe(1);
    expect(data.summary).not.toBeNull();
  });

  test('지역 미설정이면 요약도 조회하지 않는다', async () => {
    const { summaryInputs, dependencies: deps } = dependencies({ regionPreference: { areas: [], confirmedAt: null } });
    const data = await loadTodayPage(EMPTY_TODAY_SEARCH, deps);
    expect(summaryInputs).toEqual([]);
    expect(data.summary).toBeNull();
  });
  test('사람이 적은 금액을 계약 형식으로 맞춰 준다', () => {
    // 계약은 소수 둘째 자리를 고정한다. 자릿수만 다른 입력을 무효로 버리면 사용자가 적은 값이
    // 조용히 사라진다. 숫자가 아닌 입력은 그대로 계약이 거른다.
    expect(normalizeTodaySearch({ ...EMPTY_TODAY_SEARCH, baseAmountMin: '3000000', baseAmountMax: '10,000,000' }))
      .toMatchObject({ baseAmountMin: '3000000.00', baseAmountMax: '10000000.00' });
    expect(normalizeTodaySearch({ ...EMPTY_TODAY_SEARCH, baseAmountMin: '삼백만' }))
      .toMatchObject({ baseAmountMin: null });
  });
});
