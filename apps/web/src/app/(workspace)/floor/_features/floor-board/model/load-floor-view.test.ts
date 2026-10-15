import { describe, expect, test } from 'bun:test';
import { Temporal } from '@eatbid/domain';

import { linesResponse, myBidsResponse, myRegionResponse, regionsResponse } from '@/app/(workspace)/floor/__fixtures__/floor-lines';
import { loadFloorView, type FloorViewReaders } from './load-floor-view';

const today = Temporal.PlainDate.from('2026-10-15');

function readers(overrides: Partial<FloorViewReaders> = {}) {
  const calls: { lines: unknown[]; mine: unknown[] } = { lines: [], mine: [] };
  const value: FloorViewReaders = {
    regions: async () => ({ kind: 'regions', response: regionsResponse }),
    lines: async (input) => {
      calls.lines.push(input);
      return { kind: 'lines', response: linesResponse({ ranks: input.ranks }) };
    },
    mine: async (input) => {
      calls.mine.push(input);
      return { kind: 'bids', response: myBidsResponse() };
    },
    // 기본은 운영자가 아닌 사용자다. 내 업체 지역을 셀 수 없다.
    myRegion: async () => ({ kind: 'forbidden' }),
    ...overrides
  };
  return { value, calls };
}

const search = (region: string | null, ranks = false, month: string | null = null) => ({ region, period: '1y' as const, ranks, month });

describe('하한선 자리 화면 상태', () => {
  test('주소·쿠키에 지역이 없고 내 업체 지역도 셀 수 없으면 점을 부르지 않고 지역을 고르게 한다', async () => {
    const { value, calls } = readers();
    const view = await loadFloorView({ search: search(null), rememberedRegion: undefined, today }, value);
    expect(view.kind).toBe('pick');
    expect(view.kind === 'pick' && view.reason).toBe('none');
    expect(calls.lines).toHaveLength(0);
  });

  test('주소에 지역이 없으면 이 브라우저가 마지막으로 본 시군구를 같은 창으로 부른다', async () => {
    const { value, calls } = readers();
    const view = await loadFloorView({ search: search(null, true), rememberedRegion: '459', today }, value);
    expect(view.kind).toBe('ready');
    expect(calls.lines).toEqual([{ from: '2025-10-01', to: '2026-10-15', floorRate: '90.000', sigunguCodeValueId: '459', ranks: true }]);
    expect(calls.mine).toEqual([{ from: '2025-10-01', to: '2026-10-15', floorRate: '90.000', sigunguCodeValueId: '459' }]);
  });

  test('숫자 ID 모양이 아닌 쿠키 값은 고르지 않은 것으로 읽는다', async () => {
    const { value, calls } = readers();
    const view = await loadFloorView({ search: search(null), rememberedRegion: '459; path=/', today }, value);
    expect(view.kind).toBe('pick');
    expect(calls.lines).toHaveLength(0);
  });

  test('준비된 화면은 지역 이름·점·우리 값·분포 판을 싣는다', async () => {
    const view = await loadFloorView({ search: search('459'), rememberedRegion: undefined, today }, readers().value);
    if (view.kind !== 'ready') throw new Error(view.kind);
    expect(view.data.region).toEqual({ id: '459', sidoId: '40', place: '경남 김해시' });
    expect(view.data.points).toHaveLength(243);
    expect(view.data.points[0]!.opened).toBe('2025.10.02(목) 10:00 개찰');
    expect(view.data.points[0]!.month).toBe('2025-10');
    expect(view.data.ladders).toBeNull();
    expect(view.data.mine.kind === 'bids' && view.data.mine.bids.map((bid) => bid.outcome.kind)).toEqual(['below-floor', 'valid', 'valid']);
    expect(view.data.quantiles).toHaveLength(199);
    expect(view.data.provenance).toEqual({ ruleVersion: '2026-10-10', ruleSourceRounds: 108126, buildId: '901', computedAt: '2026.10.15 09:30' });
  });

  test('운영자가 아니면 우리 값 층이 없고 못 읽은 것과 구별한다', async () => {
    const forbidden = await loadFloorView(
      { search: search('459'), rememberedRegion: undefined, today },
      readers({ mine: async () => ({ kind: 'forbidden' }) }).value
    );
    const failed = await loadFloorView(
      { search: search('459'), rememberedRegion: undefined, today },
      readers({ mine: async () => ({ kind: 'read-failed' }) }).value
    );
    expect(forbidden.kind === 'ready' && forbidden.data.mine.kind).toBe('not-operator');
    expect(failed.kind === 'ready' && failed.data.mine.kind).toBe('read-failed');
  });

  test('없는 지역·공고 없는 지역·점 실패·지역 목록 실패를 서로 다른 상태로 말한다', async () => {
    const input = { search: search('459'), rememberedRegion: undefined, today };
    const notFound = await loadFloorView(input, readers({ lines: async () => ({ kind: 'region-not-found' }) }).value);
    const empty = await loadFloorView({ ...input, search: search('999') }, readers().value);
    const linesFailed = await loadFloorView(input, readers({ lines: async () => ({ kind: 'read-failed' }) }).value);
    const regionsFailed = await loadFloorView(input, readers({ regions: async () => ({ kind: 'read-failed' }) }).value);
    expect(notFound.kind === 'pick' && notFound.reason).toBe('not-found');
    // 공고 없는 지역은 고른 지역을 남겨 기간만 바꿔도 그 지역으로 다시 부른다.
    expect(empty.kind === 'pick' && [empty.reason, empty.regionId]).toEqual(['empty', '999']);
    expect(linesFailed.kind === 'lines-failed' && [linesFailed.regionId, linesFailed.sidoId]).toEqual(['459', '40']);
    expect(regionsFailed.kind).toBe('regions-failed');
  });

  test('주소·쿠키에 지역이 없으면 내 업체가 가장 많이 넣은 공고지역을 최근 1년 창으로 세어 연다', async () => {
    const asked: unknown[] = [];
    const { value, calls } = readers({
      myRegion: async (input) => {
        asked.push(input);
        return { kind: 'region', response: myRegionResponse() };
      }
    });
    const view = await loadFloorView({ search: search(null), rememberedRegion: undefined, today }, value);
    expect(asked).toEqual([{ from: '2025-10-01', to: '2026-10-15', floorRate: '90.000' }]);
    expect(view.kind === 'ready' && [view.data.region.id, view.openedBy]).toEqual(['459', 'my-bids']);
    expect(calls.lines).toHaveLength(1);
  });

  test('투찰이 없어 내 업체 지역이 없으면 지역을 지어내지 않고 고르게 한다', async () => {
    const { value } = readers({ myRegion: async () => ({ kind: 'region', response: myRegionResponse(false) }) });
    const view = await loadFloorView({ search: search(null), rememberedRegion: undefined, today }, value);
    expect(view.kind === 'pick' && view.reason).toBe('none');
  });

  test('주소의 달은 창 안이고 지난 달일 때만 확대할 달이 된다', async () => {
    const focus = async (month: string) => {
      const view = await loadFloorView({ search: search('459', false, month), rememberedRegion: undefined, today }, readers().value);
      return view.kind === 'ready' ? view.focusMonth : 'not-ready';
    };
    expect(await focus('2026-09')).toBe('2026-09');
    expect(await focus('2026-10')).toBe('2026-10');
    // 최근 1년 창 밖, 아직 안 온 달, 모양이 틀린 값은 확대하지 않는다.
    expect(await focus('2024-03')).toBeNull();
    expect(await focus('2026-11')).toBeNull();
    expect(await focus('2026-9')).toBeNull();
  });

  test('주소의 지역이 쿠키보다 먼저이고, 둘 다 있으면 내 업체 지역을 묻지 않는다', async () => {
    let asked = 0;
    const { value } = readers({
      myRegion: async () => {
        asked += 1;
        return { kind: 'region', response: myRegionResponse() };
      }
    });
    const addressed = await loadFloorView({ search: search('459'), rememberedRegion: '460', today }, value);
    const remembered = await loadFloorView({ search: search(null), rememberedRegion: '459', today }, value);
    expect(addressed.kind === 'ready' && addressed.openedBy).toBe('address');
    expect(remembered.kind === 'ready' && remembered.openedBy).toBe('remembered');
    expect(asked).toBe(0);
  });
});
