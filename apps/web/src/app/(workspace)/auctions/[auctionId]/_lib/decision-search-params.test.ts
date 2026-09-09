import { describe, expect, test } from 'bun:test';
import { createSerializer } from 'nuqs';

import {
  DECISION_EXPANDS,
  buildDecisionExpandRoute,
  buildDecisionFilterRoute,
  buildDecisionHistoryPagesRoute,
  buildDecisionHistoryReadRoute,
  buildDecisionViewRoute,
  decisionSearchParsers,
  withDecisionView,
  type DecisionSearch
} from './decision-search-params';

// 주소는 URLSearchParams 인코딩(공백은 +)이라 encodeURIComponent와 다르다. 기대값도 같은 규칙으로 만든다.
const expandQuery = (expand: string) => new URLSearchParams({ expand }).toString();

describe('결정 화면 URL 조건', () => {
  test('기본값은 12개월·전국이고 직렬화에서 생략된다', () => {
    const serialize = createSerializer(decisionSearchParsers);
    expect(serialize({ period: '12개월', scope: '전국' })).toBe('');
    expect(serialize({ period: '지난 달', scope: '이 기관' })).toContain('period=');
  });
  test('허용되지 않은 값은 parse가 null이다', () => {
    expect(decisionSearchParsers.period.parse('아무거나')).toBeNull();
  });
  test('item은 기본값이 null이고 원문 그대로 왕복한다', () => {
    const serialize = createSerializer(decisionSearchParsers);
    expect(decisionSearchParsers.item.parse('7')).toBe('7');
    expect(serialize({ period: '12개월', scope: '전국', item: null })).toBe('');
    expect(serialize({ period: '12개월', scope: '전국', item: '7' })).toContain('item=7');
  });
  test('기본 화면은 흐름이고 삭제한 분석 탭은 파싱하지 않는다', () => {
    expect(decisionSearchParsers.view.parse('흐름')).toBe('흐름');
    expect(decisionSearchParsers.view.parse('아무 탭')).toBeNull();
    expect(decisionSearchParsers.view.defaultValue).toBe('흐름');
    expect(decisionSearchParsers.view.parse('업체')).toBeNull();
    expect(decisionSearchParsers.view.parse('그날 하한')).toBeNull();
  });
  test('탭 링크는 지금 조건을 그대로 들고 간다', () => {
    const search: DecisionSearch = {
      period: '3개월',
      scope: '시군',
      view: '비교집단',
      item: '7',
      myRate: null,
      rate: null,
      expand: null,
  pages: 1
    };
    expect(buildDecisionViewRoute('4821', search, '흐름')).toBe(
      '/auctions/4821?period=3%EA%B0%9C%EC%9B%94&scope=%EC%8B%9C%EA%B5%B0&item=7&view=%ED%9D%90%EB%A6%84'
    );
  });
  test('기본값인 조건과 없는 품목은 주소에 남기지 않는다', () => {
    const search: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '흐름',
      item: null,
      myRate: null,
      rate: null,
      expand: null,
  pages: 1
    };
    expect(buildDecisionViewRoute('4821', search, '비교집단')).toBe('/auctions/4821?view=%EB%B9%84%EA%B5%90%EC%A7%91%EB%8B%A8');
  });
  test('공고 ID는 주소 조각으로 인코딩한다', () => {
    const search: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '흐름',
      item: null,
      myRate: null,
      rate: null,
      expand: null,
  pages: 1
    };
    expect(buildDecisionViewRoute('48/21', search, '흐름')).toContain('/auctions/48%2F21?');
  });

  test('내 값과 열린 크게 보기는 탭을 옮겨도 유지되고 닫힌 상태는 주소에 남지 않는다', () => {
    const search: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '비교집단',
      item: null,
      myRate: '90.030',
      rate: null,
      expand: '비교집단',
      pages: 1
    };
    const moved = buildDecisionViewRoute('4821', search, '흐름');
    expect(moved).toContain('myRate=90.030');
    expect(moved).toContain(expandQuery('비교집단'));
    const plain = buildDecisionViewRoute('4821', { ...search, myRate: null, expand: null, pages: 1 }, '흐름');
    expect(plain).not.toContain('myRate');
    expect(plain).not.toContain('expand');
  });

  test('크게 보기 링크는 탭과 나머지 조건을 그대로 두고 expand에 본문 이름만 싣거나 지운다', () => {
    const search: DecisionSearch = {
      period: '3개월',
      scope: '전국',
      view: '비교집단',
      item: null,
      myRate: '90.030',
      rate: null,
      expand: null,
  pages: 1
    };
    const expanded = buildDecisionExpandRoute('4821', search, '과거 회차');
    expect(expanded).toContain(expandQuery('과거 회차'));
    expect(expanded).toContain('myRate=90.030');
    expect(expanded).toContain('view=%EB%B9%84%EA%B5%90%EC%A7%91%EB%8B%A8');
    expect(buildDecisionExpandRoute('4821', { ...search, expand: '흐름' }, null)).not.toContain('expand');
  });

  test('이어 붙인 pages는 확대를 닫아도 주소에 남고 1회차면 남지 않는다', () => {
    // pages는 "확대가 열렸다"가 아니라 이 조회가 이어 붙인 표본 크기다. 닫을 때 지우면 불러온 회차와
    // 그 회차를 고른 선택이 함께 사라진다(EAT-115).
    const search: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '흐름',
      item: null,
      myRate: null,
      rate: null,
      expand: '과거 회차',
      pages: 3
    };
    expect(buildDecisionExpandRoute('4821', search, null)).toContain('pages=3');
    expect(buildDecisionExpandRoute('4821', search, null)).not.toContain('expand');
    expect(buildDecisionViewRoute('4821', search, '비교집단')).toContain('pages=3');
    expect(buildDecisionViewRoute('4821', { ...search, pages: 1 }, '흐름')).not.toContain('pages');
    expect(buildDecisionHistoryPagesRoute('4821', search, 4)).toContain('pages=4');
    expect(buildDecisionHistoryPagesRoute('4821', search, 4)).toContain(expandQuery('과거 회차'));
    expect(decisionSearchParsers.pages.defaultValue).toBe(1);
  });

  test('historyRead는 latest 하나뿐이며 기본 cached 경로는 주소에 남지 않는다', () => {
    expect(decisionSearchParsers.historyRead.parse('latest')).toBe('latest');
    expect(decisionSearchParsers.historyRead.parse('nonce-123')).toBeNull();
    const base: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '흐름',
      item: null,
      myRate: null,
      rate: null,
      expand: null,
      pages: 1
    };
    const latest: DecisionSearch = { ...base, historyRead: 'latest' };
    // 같은 공고 안의 링크는 모두 모드를 보존한다. 하나라도 빠지면 복구 중에 stale 캐시로 되돌아간다.
    expect(buildDecisionViewRoute('4821', latest, '흐름')).toContain('historyRead=latest');
    expect(buildDecisionExpandRoute('4821', latest, '과거 회차')).toContain('historyRead=latest');
    expect(buildDecisionHistoryPagesRoute('4821', latest, 2)).toContain('historyRead=latest');
    expect(buildDecisionFilterRoute('4821', latest, { period: '3개월' })).toContain('historyRead=latest');
    expect(buildDecisionHistoryReadRoute('4821', base, 'latest')).toContain('historyRead=latest');
    expect(buildDecisionHistoryReadRoute('4821', latest, null)).not.toContain('historyRead');
    expect(buildDecisionViewRoute('4821', base, '흐름')).not.toContain('historyRead');
  });

  test('조건을 바꾸면 이전 집단의 cursor 페이지 수를 물려받지 않는다', () => {
    const search: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '흐름',
      item: null,
      myRate: null,
      rate: null,
      expand: '과거 회차',
      pages: 3
    };
    expect(buildDecisionFilterRoute('4821', search, { period: '3개월' })).not.toContain('pages');
  });

  test('expand는 지원하는 확대 보기만 통과하고 기본값이 없어 닫힌 상태는 null이다', () => {
    for (const expand of DECISION_EXPANDS) expect(decisionSearchParsers.expand.parse(expand)).toBe(expand);
    expect(DECISION_EXPANDS).toEqual(['과거 회차', '흐름', '비교집단']);
    expect(decisionSearchParsers.expand.parse('true')).toBeNull();
    expect('defaultValue' in decisionSearchParsers.expand && decisionSearchParsers.expand.defaultValue !== undefined).toBe(false);
  });

  test('myRate는 기본값 없이 원문 그대로 왕복한다', () => {
    // 최빈 칸이나 하한율을 기본값으로 두면 그것이 추천값이 된다(AGENTS 8, PDR-0004).
    expect(decisionSearchParsers.myRate.parse('90.030')).toBe('90.030');
  });

  test('손잡이 투찰률 rate는 기본값이 없고 사용자가 놓은 값만 탭 링크에 실린다', () => {
    // 손잡이에 90.000 같은 시작값을 두면 표 마지막 열·이 값이면까지 번지는 추천값이 된다(AGENTS 8, EAT-84).
    expect('defaultValue' in decisionSearchParsers.rate && decisionSearchParsers.rate.defaultValue !== undefined).toBe(false);
    expect(decisionSearchParsers.rate.parse('90.300')).toBe('90.300');
    const search: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '비교집단',
      item: null,
      myRate: null,
      rate: '90.300',
      expand: null,
  pages: 1
    };
    expect(buildDecisionViewRoute('4821', search, '흐름')).toContain('rate=90.300');
    expect(buildDecisionViewRoute('4821', { ...search, rate: null }, '흐름')).not.toContain('rate=');
  });

  test('서버가 그린 주소의 view만 지금 보는 본문으로 갈아 끼우고 나머지 조건은 건드리지 않는다', () => {
    // 흐름↔분포는 서버 왕복 없이 바뀌므로 서버가 아는 view는 한 걸음 지날 수 있다(EAT-139).
    const search: DecisionSearch = {
      period: '3개월',
      scope: '시군',
      view: '흐름',
      item: '7',
      myRate: '90.030',
      rate: null,
      expand: null,
      pages: 2
    };
    const route = withDecisionView(buildDecisionFilterRoute('4821', search, { period: '12개월' }), '비교집단');
    const query = new URLSearchParams(route.slice(route.indexOf('?')));
    expect(query.get('view')).toBe('비교집단');
    expect(query.get('scope')).toBe('시군');
    expect(query.get('item')).toBe('7');
    expect(query.get('myRate')).toBe('90.030');
    // 조건이 달라지면 이전 집단의 cursor 페이지 수는 물려받지 않는다.
    expect(query.get('pages')).toBeNull();
    expect(route.startsWith('/auctions/4821?')).toBe(true);
  });
});
