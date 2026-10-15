import { describe, expect, test } from 'bun:test';
import { Temporal } from '@eatbid/domain';
import type { FloorLinesV1Response } from '@eatbid/contracts/api/v1/analysis';
import type { MyFloorRegionV1Response } from '@eatbid/contracts/api/v1/me';

import { loadAuctionRegionEntry, loadMonthEntry, loadRecentEntry, presentMonthEntry, presentRecentEntry, type FloorEntryReaders } from './floor-entry';

const today = Temporal.PlainDate.from('2026-10-15');

// 합성 표본이다. 하한선 값과 개찰 시각만 쓰므로 나머지는 최소로 채운다.
function lines(floors: readonly (readonly [string, number])[]): FloorLinesV1Response {
  return {
    points: floors.map(([openedAt, floor], index) => ({
      attemptId: String(index + 1),
      revisionId: String(index + 1001),
      openedAt,
      organizationName: null,
      baseAmount: { amount: '10000000.00', currency: 'KRW' },
      floor: { value: floor.toFixed(4), unit: 'percentage-points' }
    })),
    ladders: null,
    rule: { version: '2026-10-10', sourceRounds: 1, quantiles: { unit: 'percentage-points', denominator: 'base-amount', values: ['90.0000'] } },
    meta: {
      build: { buildId: '1', sourceReleaseId: null, calcVersion: null, computedAt: null, coverage: null, regionScheme: null },
      region: { codeValueId: '459', label: '김해시' },
      period: { from: '2025-10-01', to: '2026-10-15' },
      floorRate: { value: '90.000', unit: 'percentage-points' },
      pointCount: floors.length
    }
  };
}

// 89.1~90.0%를 고르게 열 개, 이번 달(10월) 둘. 가운데 절반은 89.3%~89.7%라 사정률 99.2~99.7이다.
const TEN = lines([
  ...Array.from({ length: 8 }, (_, index) => [`2026-09-${String(index + 1).padStart(2, '0')}T01:00:00Z`, 89.1 + index * 0.1] as const),
  ['2026-10-02T01:00:00Z', 89.9],
  ['2026-10-13T01:00:00Z', 90.0]
]);

const region = (found: boolean): MyFloorRegionV1Response => ({
  region: found ? { sido: { codeValueId: '40', label: '경남' }, sigungu: { codeValueId: '459', label: '김해시' }, roundCount: 637 } : null,
  meta: { period: { from: '2025-10-01', to: '2026-10-15' }, floorRate: { value: '90.000', unit: 'percentage-points' }, linkedBusinessCount: 2, unlinkedBusinessCount: 0 }
});

describe('하한선 자리 입구 줄 문장', () => {
  test('내 지역 줄은 최근 1년 가운데 절반을 사정률로 말하고 넣을 자리가 아니라고 붙이며 이번 달 개찰 수를 단다', () => {
    const view = presentRecentEntry({ response: TEN, place: '김해시', regionId: '459', currentMonth: '2026-10', form: 'mine' });
    expect(view).toEqual({
      lead: '김해시 하한선 · 최근 1년 열 번 중 다섯 번은 ',
      strong: '사정률 99.2~99.7',
      rest: '(넣을 자리는 아니에요) · 이번 달 개찰 2건',
      linkText: '하한선 자리 보기 →',
      href: '/floor?region=459'
    });
  });

  test('공고 상세 줄은 "이 지역"이라고 부르고 이번 달 수를 달지 않는다', () => {
    const view = presentRecentEntry({ response: TEN, place: '창원시', regionId: '43', currentMonth: '2026-10', form: 'this-auction' });
    expect([view.lead, view.rest, view.href]).toEqual(['이 지역(창원시) 하한선 · 최근 1년 열 번 중 다섯 번은 ', '(넣을 자리는 아니에요)', '/floor?region=43']);
  });

  test('공고가 적으면 범위 대신 건수만 말한다', () => {
    const view = presentRecentEntry({ response: lines([['2026-09-01T01:00:00Z', 90]]), place: '김해시', regionId: '459', currentMonth: '2026-10', form: 'mine' });
    expect([view.lead, view.strong, view.rest]).toEqual(['김해시 하한율 90% 공고 · 최근 1년 ', '1건', ' · 이번 달 개찰 0건']);
  });

  test('복기 줄은 그 달 공고 수와 범위를 말하고 그 달로 확대해 여는 링크를 단다', () => {
    const view = presentMonthEntry({ response: TEN, place: '김해시', regionId: '459', month: '2026-09', period: '1y' });
    expect(view).toEqual({
      lead: '9월 김해시 하한율 90% 공고 10건 · 열 번 중 다섯 번은 ',
      strong: '사정률 99.2~99.7',
      rest: '(넣을 자리는 아니에요)',
      linkText: '9월 하한선 보기 →',
      href: '/floor?region=459&month=2026-09'
    });
    expect(presentMonthEntry({ response: lines([]), place: '김해시', regionId: '459', month: '2024-01', period: '3y' }).lead).toBe('1월 김해시에는 하한율 90% 공고가 없어요.');
  });
});

describe('하한선 자리 입구 줄 조회', () => {
  function readers(found: RegionReadKind = 'found') {
    const asked: unknown[] = [];
    const value: FloorEntryReaders = {
      myRegion: async () => (found === 'forbidden' ? { kind: 'forbidden' } : { kind: 'region', response: region(found === 'found') }),
      lines: async (input) => {
        asked.push(input);
        return { kind: 'lines', response: TEN };
      }
    };
    return { value, asked };
  }
  type RegionReadKind = 'found' | 'none' | 'forbidden';

  test('내 업체 주 공고지역의 최근 1년 창으로 하한선을 읽는다', async () => {
    const { value, asked } = readers();
    expect((await loadRecentEntry(today, value))?.href).toBe('/floor?region=459');
    expect(asked).toEqual([{ from: '2025-10-01', to: '2026-10-15', floorRate: '90.000', sigunguCodeValueId: '459', ranks: false }]);
  });

  test('운영자가 아니거나 투찰이 없으면 지역을 지어내지 않고 줄을 내지 않는다', async () => {
    expect(await loadRecentEntry(today, readers('forbidden').value)).toBeNull();
    expect(await loadMonthEntry(today, '2026-09', readers('none').value)).toBeNull();
  });

  test('복기 줄은 그 달 창만 읽고, 이번 달이면 오늘까지다', async () => {
    const { value, asked } = readers();
    await loadMonthEntry(today, '2026-09', value);
    await loadMonthEntry(today, '2026-10', value);
    expect(asked).toEqual([
      { from: '2026-09-01', to: '2026-09-30', floorRate: '90.000', sigunguCodeValueId: '459', ranks: false },
      { from: '2026-10-01', to: '2026-10-15', floorRate: '90.000', sigunguCodeValueId: '459', ranks: false }
    ]);
    // 1년 창 밖 달은 3년 창으로 열어 그 달을 담는다.
    expect((await loadMonthEntry(today, '2024-03', value))?.href).toBe('/floor?region=459&period=3y&month=2024-03');
  });

  test('공고 상세 줄은 공고의 공고지역을 그대로 쓰고 하한선을 못 읽으면 줄을 내지 않는다', async () => {
    const { value, asked } = readers();
    expect((await loadAuctionRegionEntry(today, { id: '43', label: '창원시' }, value))?.lead).toStartWith('이 지역(창원시)');
    expect(asked).toEqual([{ from: '2025-10-01', to: '2026-10-15', floorRate: '90.000', sigunguCodeValueId: '43', ranks: false }]);
    expect(await loadAuctionRegionEntry(today, { id: '43', label: null }, { lines: async () => ({ kind: 'read-failed' }) })).toBeNull();
  });
});
