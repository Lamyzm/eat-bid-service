import { describe, expect, test } from 'bun:test';
import { createSerializer } from 'nuqs';

import {
  buildDecisionExpandRoute,
  buildDecisionViewRoute,
  decisionSearchParsers,
  type DecisionSearch
} from './decision-search-params';

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
  test('view는 기본값이 비교집단이고 허용된 탭만 통과한다', () => {
    expect(decisionSearchParsers.view.parse('흐름')).toBe('흐름');
    expect(decisionSearchParsers.view.parse('아무 탭')).toBeNull();
    expect(decisionSearchParsers.view.defaultValue).toBe('비교집단');
  });
  test('탭 링크는 지금 조건을 그대로 들고 간다', () => {
    const search: DecisionSearch = {
      period: '3개월',
      scope: '시군',
      view: '비교집단',
      item: '7',
      myRate: null,
      expand: false
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
      expand: false
    };
    expect(buildDecisionViewRoute('4821', search, '업체')).toBe('/auctions/4821?view=%EC%97%85%EC%B2%B4');
  });
  test('공고 ID는 주소 조각으로 인코딩한다', () => {
    const search: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '흐름',
      item: null,
      myRate: null,
      expand: false
    };
    expect(buildDecisionViewRoute('48/21', search, '흐름')).toContain('/auctions/48%2F21?');
  });

  test('내 값과 크게 보기는 탭을 옮겨도 유지되고 기본 상태는 주소에 남지 않는다', () => {
    const search: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '비교집단',
      item: null,
      myRate: '90.030',
      expand: true
    };
    const moved = buildDecisionViewRoute('4821', search, '흐름');
    expect(moved).toContain('myRate=90.030');
    expect(moved).toContain('expand=true');
    const plain = buildDecisionViewRoute('4821', { ...search, myRate: null, expand: false }, '흐름');
    expect(plain).not.toContain('myRate');
    expect(plain).not.toContain('expand');
  });

  test('크게 보기 토글은 탭과 나머지 조건을 그대로 두고 expand만 뒤집는다', () => {
    const search: DecisionSearch = {
      period: '3개월',
      scope: '전국',
      view: '비교집단',
      item: null,
      myRate: '90.030',
      expand: false
    };
    const expanded = buildDecisionExpandRoute('4821', search, true);
    expect(expanded).toContain('expand=true');
    expect(expanded).toContain('myRate=90.030');
    expect(expanded).toContain('view=%EB%B9%84%EA%B5%90%EC%A7%91%EB%8B%A8');
    expect(buildDecisionExpandRoute('4821', { ...search, expand: true }, false)).not.toContain('expand');
  });

  test('myRate는 기본값 없이 원문 그대로 왕복한다', () => {
    // 최빈 칸이나 하한율을 기본값으로 두면 그것이 추천값이 된다(AGENTS 8, PDR-0004).
    expect(decisionSearchParsers.myRate.parse('90.030')).toBe('90.030');
    expect(decisionSearchParsers.expand.defaultValue).toBe(false);
  });
});
