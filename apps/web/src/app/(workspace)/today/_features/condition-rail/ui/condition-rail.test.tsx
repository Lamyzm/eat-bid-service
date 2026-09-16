import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { fixtureNow, openSummaryFixture } from '@/app/(workspace)/today/__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH, type TodaySearch } from '@/app/(workspace)/today/_lib/today-search-params';
import { presentOpenSummary } from '@/app/(workspace)/today/_model/present-open-summary';
import { presentConditionRail } from '../model/present-condition-rail';
import { ConditionRail } from './condition-rail';

const gate = { kind: 'applied', areas: [{ codeValueId: '9102', code: '15653', label: '경남/김해시' }] } as const;

function renderRail(search: TodaySearch) {
  const summary = presentOpenSummary(openSummaryFixture, fixtureNow, search);
  return render(<ConditionRail rail={presentConditionRail({ search, summary, gate })} />);
}

describe('조건 기둥', () => {
  test('지역·품목 묶음이 이름을 갖고 체크 줄은 주소를 바꾸는 링크라 고른 것을 aria-current로 말한다', () => {
    const screen = renderRail({ ...EMPTY_TODAY_SEARCH, sido: '41', sigungu: ['43'], items: ['육류'] });
    // `details`도 group이라 이름 있는 묶음만 센다. 기초금액은 입력의 label이 이름을 갖는다.
    expect(screen.getByRole('group', { name: '지역' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '품목' })).toBeTruthy();
    const changwon = screen.getByRole('link', { name: '창원시 2' });
    expect(changwon.getAttribute('aria-current')).toBe('true');
    expect(changwon.getAttribute('href')).toBe('/today?sido=41&items=육류');
    expect(screen.getByRole('link', { name: '코드 48250 1' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: '육류 2' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('link', { name: '수산물 0' })).toBeTruthy();
  });

  test('품목 축이 없으면 품목 미상은 링크가 아니라 수만 말하고 지역 미상도 수만 말한다', () => {
    const screen = renderRail(EMPTY_TODAY_SEARCH);
    expect(screen.queryByRole('link', { name: /품목 미상/ })).toBeNull();
    expect(screen.getByText('품목 미상')).toBeTruthy();
    expect(screen.getByText('지역 미상 1')).toBeTruthy();
  });

  test('기초금액은 라벨이 연결된 한 칸이고 GET form이 다른 조건을 hidden으로 나르며 걸린 값은 기본값으로 되돌릴 수 있다', () => {
    const screen = renderRail({ ...EMPTY_TODAY_SEARCH, sido: '41', baseAmountMin: '3000000.00' });
    const input = screen.getByLabelText('기초금액') as HTMLInputElement;
    expect(input.name).toBe('baseAmountMin');
    expect(input.value).toBe('3,000,000');
    // placeholder는 라벨이 아니다. 비었을 때 `하한 없음`이 보이는 것은 값 자리의 힌트일 뿐이다.
    expect(input.placeholder).toBe('하한 없음');
    const form = input.closest('form')!;
    expect(form.getAttribute('method')).toBe('get');
    expect([...form.querySelectorAll('input[type="hidden"]')].map((node) => [node.getAttribute('name'), node.getAttribute('value')]))
      .toEqual([['sido', '41']]);
    expect(screen.getByRole('link', { name: '기본값으로' }).getAttribute('href')).toBe('/today?sido=41');
    // 버튼은 없다. Enter가 제출이고 시안에도 없다(사용자 결정 2026-09-17).
    expect(screen.queryByRole('button', { name: '적용' })).toBeNull();
  });

  test('참가제한 게이트는 지역 구역 아래 출구 두 링크뿐이고 문장은 title로만 남는다', () => {
    const screen = renderRail(EMPTY_TODAY_SEARCH);
    expect(screen.queryByText('내가 고른 지역의 공고 · 경남/김해시')).toBeNull();
    expect(screen.getByTitle('내가 고른 지역의 공고 · 경남/김해시')).toBeTruthy();
    expect(screen.getByRole('link', { name: '전체 보기' }).getAttribute('href')).toBe('/today?scope=all');
    expect(screen.getByRole('link', { name: '지역 바꾸기' }).getAttribute('href')).toBe('/setup?return=%2Ftoday');
  });
});
