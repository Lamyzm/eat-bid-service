import { describe, expect, test } from 'bun:test';

import { matchedCount, matchesSchool, schoolFilterStatus, schoolQueryKey } from './school-filter';

const rows = [
  { organization: '덕정초등학교', title: '덕정초등학교 2026년 11월 학교급식품(육류) 구매' },
  { organization: '김해율하고등학교', title: '2026학년도 11월 학교급식품(축산물) 식재료 구매 계약' },
  { organization: '기관 미상', title: '(주촌초등학교) 2026년 11월 식재료(육류) 구입' }
];

describe('오늘 투찰 학교 거르기', () => {
  test('검색어는 공백을 무시하고 학교 이름 일부로 맞춘다', () => {
    expect(schoolQueryKey(' 덕정 초 ')).toBe('덕정초');
    expect(matchesSchool(schoolQueryKey('덕정 초'), rows[0]!)).toBe(true);
    expect(matchesSchool(schoolQueryKey('율하'), rows[1]!)).toBe(true);
    expect(matchesSchool(schoolQueryKey('율하'), rows[0]!)).toBe(false);
  });

  test('기관 이름에 없으면 제목에서 찾고, 검색어가 비면 모든 행이 맞는다', () => {
    expect(matchesSchool(schoolQueryKey('주촌'), rows[2]!)).toBe(true);
    expect(matchedCount('', rows)).toBe(3);
  });

  test('남은 건수를 전체와 함께 말하고, 없으면 그렇다고 말하며, 검색어가 없으면 말하지 않는다', () => {
    expect(schoolFilterStatus('덕정', matchedCount(schoolQueryKey('덕정'), rows), rows.length)).toBe('3건 중 1건');
    expect(schoolFilterStatus('없는학교 ', 0, 3)).toBe("'없는학교'에 맞는 학교 공고가 없어요.");
    expect(schoolFilterStatus('  ', 3, 3)).toBeNull();
  });
});
