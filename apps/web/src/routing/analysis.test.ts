import { expect, test } from 'bun:test';
import { buildAnalysisRoute } from './analysis';

test('분석 화면 경로는 식별자와 검색값을 한 번씩 인코딩한다', () => {
  const route = buildAnalysisRoute({
    schoolId: '서울|가람 학교',
    bidNumber: 'A/B 10',
    rate: '87.1234',
    baseAmount: '100000.50'
  });

  expect(route).toBe(
    '/dashboard/analysis/%EC%84%9C%EC%9A%B8%7C%EA%B0%80%EB%9E%8C%20%ED%95%99%EA%B5%90?bidNo=A%2FB+10&rate=87.1234&base=100000.50'
  );
});

test('선택 검색값이 없으면 분석 화면 pathname만 만든다', () => {
  expect(buildAnalysisRoute({ schoolId: 'school-1' })).toBe('/dashboard/analysis/school-1');
});
