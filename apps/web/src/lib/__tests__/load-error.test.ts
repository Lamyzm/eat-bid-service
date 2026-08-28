// 막는 사고: 실패 문구를 호출부마다 새로 지어 표기가 갈리던 것.
// 그리고 조사('을/를')를 손으로 붙이다 "90.319은" 같은 오류를 낸 적이 있다.
import { expect, test } from 'bun:test';
import { loadErrorMessage } from '../../components/load-error';

test('받침에 따라 조사가 갈린다', () => {
  expect(loadErrorMessage('공고 목록')).toBe('공고 목록을 불러오지 못했습니다.'); // 록: 받침 있음
  expect(loadErrorMessage('개찰 결과')).toBe('개찰 결과를 불러오지 못했습니다.'); // 과: 받침 없음
  expect(loadErrorMessage('과거 기록')).toBe('과거 기록을 불러오지 못했습니다.');
  expect(loadErrorMessage('전체 집계')).toBe('전체 집계를 불러오지 못했습니다.');
});
