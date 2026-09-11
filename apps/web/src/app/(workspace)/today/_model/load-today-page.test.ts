import { describe, expect, test } from 'bun:test';

import { fixtureNow, noSnapshotFixture, openAuctionsFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import {
  loadTodayPage,
  normalizeTodaySearch,
  type TodayListInput,
  type TodayListRead,
  type TodayRegionPreference
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
  return {
    inputs,
    dependencies: {
      listOpenAuctions: async (input: TodayListInput) => {
        inputs.push(input);
        return page;
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
      { scope: null, region: '01', item: '축산', closesWithinHours: 721, baseAmountMin: '2000000', baseAmountMax: '3000000.00', cursor: 'abc' },
      deps
    );
    expect(inputs).toEqual([{
      region: undefined,
      eligibilityArea: ['9101', '9102'],
      item: '축산',
      closesWithinHours: undefined,
      baseAmountMin: undefined,
      baseAmountMax: '3000000.00',
      cursor: undefined
    }]);
    expect(data.search).toEqual({ scope: null, region: null, item: '축산', closesWithinHours: null, baseAmountMin: null, baseAmountMax: '3000000.00', cursor: null });
    expect(data.cursorReset).toBe(false);
    expect(data.presentation!.view.kind === 'list' ? data.presentation!.view.rows.length : 0).toBe(4);
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
    expect(normalizeTodaySearch({ scope: null, region: '9223372036854775807', item: 'x'.repeat(513), closesWithinHours: 0, baseAmountMin: '1.00', baseAmountMax: null, cursor: '5' }))
      .toEqual({ scope: null, region: '9223372036854775807', item: null, closesWithinHours: null, baseAmountMin: '1.00', baseAmountMax: null, cursor: '5' });
  });
});
