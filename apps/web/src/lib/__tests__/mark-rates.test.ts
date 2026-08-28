// 막는 사고: 회차당 값이 1개뿐이라 두 사업자로 넣는 값의 46%가 저장될 자리조차 없던 것.
// 그리고 사업자 등록 전에 저장한 값(미지정 슬롯)이 화면에서 통째로 사라지던 것.
import { expect, test } from 'bun:test';
import { ratesOf, slotKeysFor, withRate, primaryRate, stripMirror } from '../mark-rates';

// 픽스처: 브라우저 실측으로 localStorage 에 실제 기록된 형태 (eatbid.marks)
const REAL = { s: 'done' as const, rates: { '': 90.06, '6058101946': 90.123 } };
const BIZ = ['6058101946', '1234567890'];

test('레거시 값 하나는 첫 사업자 칸에 귀속된다 (규칙 A)', () => {
  const legacy = { s: 'done' as const, rate: 90.06 };
  expect(ratesOf(legacy, BIZ)).toEqual({ '6058101946': 90.06 });
  expect(ratesOf(legacy, [])).toEqual({ '': 90.06 }); // 등록 사업자가 없으면 미지정
});

test('미지정 슬롯 값이 사라지지 않는다', () => {
  expect(slotKeysFor(REAL, BIZ)).toEqual(['6058101946', '1234567890', '']);
  expect(ratesOf(REAL, BIZ)['']).toBe(90.06);
});

test('한 칸을 고쳐도 다른 칸이 남는다', () => {
  const next = withRate(REAL, '1234567890', 90.319, BIZ)!;
  expect(next.rates).toEqual({ '': 90.06, '6058101946': 90.123, '1234567890': 90.319 });
});

test('알 수 없는 필드를 보존한다', () => {
  const withExtra = { ...REAL, memo: '수기' } as any;
  expect((withRate(withExtra, '6058101946', 90.5, BIZ) as any).memo).toBe('수기');
});

test('저장에는 rate 미러를 남기지 않는다 (3단계)', () => {
  const next = withRate(REAL, '6058101946', 90.5, BIZ)!;
  expect('rate' in next).toBe(false);
  expect('rate' in stripMirror({ ...REAL, rate: 90.06 })).toBe(false);
});

test('대표값은 미지정 → 첫 사업자 순서다', () => {
  expect(primaryRate(REAL, BIZ)).toBe(90.123);          // 등록 사업자 우선
  expect(primaryRate(REAL, [])).toBe(90.06);            // 슬롯이 미지정뿐이면 그 값
});
