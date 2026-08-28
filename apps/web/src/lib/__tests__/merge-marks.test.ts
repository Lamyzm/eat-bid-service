// 막는 사고: 로그인할 때마다 서버 엔트리가 로컬을 통째로 덮어 둘째 사업자 값을 지운 것.
// 서버가 구 계약(rate 1개)을 주던 동안 사용자는 로그인만 하면 값을 잃었다.
import { expect, test } from 'bun:test';
import { mergeMarks } from '../session';

// 픽스처: 실제 형태 — 로컬은 사업자별 rates, 서버는 구 계약 미러
const LOCAL = { '5796579': { s: 'done' as const, rates: { '6058101946': 90.099, '1234567890': 90.319 } } };
const SERVER_OLD = { '5796579': { s: 'done' as const, rate: 90.099 } };

test('서버가 구 계약을 줘도 둘째 사업자 값이 남는다', () => {
  const merged = mergeMarks(LOCAL, SERVER_OLD);
  expect(merged['5796579'].rates).toEqual({ '6058101946': 90.099, '1234567890': 90.319 });
});

test('로컬에 사업자별 값이 없으면 서버가 우선한다', () => {
  const merged = mergeMarks({ A: { s: 'watch' } }, { A: { s: 'done', rate: 90.5 } });
  expect(merged.A).toEqual({ s: 'done', rate: 90.5 });
});

test('한쪽에만 있는 회차는 둘 다 남는다', () => {
  const merged = mergeMarks({ A: { s: 'watch' } }, { B: { s: 'done', rate: 1 } });
  expect(Object.keys(merged).sort()).toEqual(['A', 'B']);
});
