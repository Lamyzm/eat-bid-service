import { describe, expect, test } from 'bun:test';

import { fixtureNow, noSnapshotFixture, openAuctionsFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import { loadTodayPage, normalizeTodaySearch, type TodayListInput, type TodayListRead } from './load-today-page';

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
      ...overrides
    }
  };
}

describe('오늘 route loader', () => {
  test('URL에 남은 잘못된 값은 무시하고 계약이 받는 조건만 조회에 넘긴다', async () => {
    const { inputs, dependencies: deps } = dependencies();
    const data = await loadTodayPage(
      { region: '01', item: '축산', closesWithinHours: 721, baseAmountMin: '2000000', baseAmountMax: '3000000.00', cursor: 'abc' },
      deps
    );
    expect(inputs).toEqual([{ region: undefined, item: '축산', closesWithinHours: undefined, baseAmountMin: undefined, baseAmountMax: '3000000.00', cursor: undefined }]);
    expect(data.search).toEqual({ region: null, item: '축산', closesWithinHours: null, baseAmountMin: null, baseAmountMax: '3000000.00', cursor: null });
    expect(data.cursorReset).toBe(false);
    expect(data.presentation.rows.length).toBe(4);
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
    expect(data.presentation.hasSnapshotBuild).toBe(false);
    expect(data.presentation.rows).toEqual([]);
  });

  test('정규화는 계약 schema의 같은 필드로 판정한다', () => {
    expect(normalizeTodaySearch({ region: '9223372036854775807', item: 'x'.repeat(513), closesWithinHours: 0, baseAmountMin: '1.00', baseAmountMax: null, cursor: '5' }))
      .toEqual({ region: '9223372036854775807', item: null, closesWithinHours: null, baseAmountMin: '1.00', baseAmountMax: null, cursor: '5' });
  });
});
