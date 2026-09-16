import { describe, expect, test } from 'bun:test';
import { fixtureNow, openSummaryFixture } from '@/app/(workspace)/today/__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH, type TodaySearch } from '@/app/(workspace)/today/_lib/today-search-params';
import type { TodayRegionGate } from '@/app/(workspace)/today/_model/load-today-page';
import { presentOpenSummary } from '@/app/(workspace)/today/_model/present-open-summary';
import { presentConditionRail } from './present-condition-rail';

const areas = [
  { codeValueId: '9101', code: '15000', label: '경남/전체' },
  { codeValueId: '9102', code: '15653', label: '경남/김해시' }
];
const applied: TodayRegionGate = { kind: 'applied', areas };

function rail(search: TodaySearch, gate: TodayRegionGate = applied) {
  return presentConditionRail({ search, summary: presentOpenSummary(openSummaryFixture, fixtureNow, search), gate });
}

describe('조건 기둥 표시 모델', () => {
  test('시도 줄은 전체와 관측된 시도이고 시도를 바꾸는 링크는 시군구를 함께 지운다', () => {
    const { region } = rail({ ...EMPTY_TODAY_SEARCH, sido: '41', sigungu: ['43'] });
    expect(region.sidoText).toBe('경상남도');
    expect(region.sidoRows.map((row) => [row.label, row.countText, row.active])).toEqual([['전체', '', false], ['경상남도', '3', true]]);
    expect(region.sidoRows[0]!.href).toBe('/today');
    expect(region.sidoRows[1]!.href).toBe('/today?sido=41');
  });

  test('시군구 줄은 고른 시도 안의 짝이고 누르면 그 하나만 켜거나 끈다', () => {
    const { region } = rail({ ...EMPTY_TODAY_SEARCH, sido: '41', sigungu: ['43'] });
    // 라벨을 관측하지 못한 44는 지어낸 이름 대신 코드로 부르되 항목으로 남는다(AGENTS 3).
    expect(region.sigunguRows.map((row) => [row.label, row.countText, row.active])).toEqual([['창원시', '2', true], ['코드 48250', '1', false]]);
    expect(region.sigunguRows[0]!.href).toBe('/today?sido=41');
    expect(region.sigunguRows[1]!.href).toBe('/today?sido=41&sigungu=43,44');
    // 지역 미상은 시도를 골랐을 때 켜고 끌 수 있는 줄이다(EAT-260). 켜면 시도·시군구는 그대로 남는다.
    expect([region.unknownRow.label, region.unknownRow.countText, region.unknownRow.active]).toEqual(['지역 미상', '1', false]);
    expect(region.unknownRow.href).toBe('/today?sido=41&sigungu=43&regionUnknown=include');
    expect(rail({ ...EMPTY_TODAY_SEARCH, sido: '41', regionUnknown: 'include' }).region.unknownRow.active).toBe(true);
    // 시도 축이 없으면 이미 전부 보고 있어 누를 것이 없다.
    expect(rail(EMPTY_TODAY_SEARCH).region.unknownRow.href).toBeNull();
  });

  test('요약이 없으면 줄은 남되 건수가 비고 지역 미상은 말하지 않는다', () => {
    const presentation = presentConditionRail({ search: EMPTY_TODAY_SEARCH, summary: null, gate: applied });
    // 빈 건수는 0이 아니라 못 센 것이다. 0으로 채우면 화면이 없는 사실을 말한다.
    expect(presentation.item.rows.every((row) => row.countText === '')).toBe(true);
    expect(presentation.region.sigunguRows).toEqual([]);
    expect(presentation.region.unknownRow.countText).toBe('');
  });

  test('품목 줄은 여덟 원자가 어휘 순서로 서고 0건도 남으며 누르면 조각 하나를 토글한다', () => {
    const { item } = rail(EMPTY_TODAY_SEARCH);
    expect(item.rows.map((row) => [row.label, row.countText])).toEqual([
      ['육류', '2'], ['가금류', '1'], ['농산물', '1'], ['수산물', '0'], ['가공식품', '0'], ['김치류', '0'], ['곡류', '0'], ['우유류', '0']
    ]);
    expect(item.rows[0]!.href).toBe('/today?items=육류');
    // 품목 축이 없으면 미상은 이미 보고 있어 누를 것이 없다.
    expect(item.unknownRow).toMatchObject({ label: '품목 미상', countText: '1', active: false, href: null });

    const narrowed = rail({ ...EMPTY_TODAY_SEARCH, items: ['육류'] });
    expect(narrowed.item.rows[0]).toMatchObject({ active: true, href: '/today' });
    expect(narrowed.item.unknownRow).toMatchObject({ active: false, href: '/today?items=육류&itemUnknown=include' });
    const included = rail({ ...EMPTY_TODAY_SEARCH, items: ['육류'], itemUnknown: 'include' });
    expect(included.item.unknownRow).toMatchObject({ active: true, href: '/today?items=육류' });
  });

  test('기초금액은 최소 한 칸이고 form이 나머지 조건을 hidden으로 나르며 cursor는 뺀다', () => {
    const { amount } = rail({ ...EMPTY_TODAY_SEARCH, sido: '41', sigungu: ['43', '44'], items: ['육류'], cursor: '9', baseAmountMin: '3000000.00' });
    expect(amount.valueText).toBe('3,000,000');
    expect(amount.carried).toEqual([{ key: 'sido', value: '41' }, { key: 'sigungu', value: '43,44' }, { key: 'items', value: '육류' }]);
    expect(amount.clearHref).toBe('/today?sido=41&sigungu=43,44&items=육류');
    expect(rail(EMPTY_TODAY_SEARCH).amount).toMatchObject({ valueText: '', clearHref: null });
  });

  test('참가제한 게이트는 체크 목록이 아니라 한 줄 사실과 출구 둘이며 지역이 다른 축임을 말한다', () => {
    expect(rail(EMPTY_TODAY_SEARCH).region.gate).toEqual({
      text: '내가 고른 지역의 공고 · 경남/전체 · 경남/김해시',
      links: [{ label: '전체 보기', href: '/today?scope=all' }, { label: '지역 바꾸기', href: '/setup?return=%2Ftoday' }]
    });
    expect(rail({ ...EMPTY_TODAY_SEARCH, scope: 'all' }, { kind: 'all-regions', areas }).region.gate).toMatchObject({
      text: '전국 공고',
      links: [{ label: '내 지역만 보기', href: '/today' }, { label: '지역 바꾸기', href: '/setup?return=%2Ftoday' }]
    });
    expect(rail(EMPTY_TODAY_SEARCH, { kind: 'unknown' }).region.gate).toBeNull();
  });
});
