import { describe, expect, test } from 'bun:test';
import { Temporal } from '@eatbid/domain';

import { linesResponse, myBidsResponse, regionsResponse } from '@/app/(workspace)/floor/__fixtures__/floor-lines';
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
    ...overrides
  };
  return { value, calls };
}

const search = (region: string | null, ranks = false) => ({ region, period: '1y' as const, ranks });

describe('하한선 자리 화면 상태', () => {
  test('주소에도 쿠키에도 지역이 없으면 점을 부르지 않고 지역을 고르게 한다', async () => {
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
});
