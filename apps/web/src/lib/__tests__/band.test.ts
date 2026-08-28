// 막는 사고: 서버가 품목별 band 를 보내는데 웹이 안 읽어, 축산 사장이 김치 섞인 구간을 본 것.
// 그리고 어느 근거로 고른 구간인지 화면이 안 밝혀 세 화면이 다른 하한을 근거로 말한 것(D-12).
import { expect, test } from 'bun:test';
import { pickBand, bandBasisText } from '../band';

// 픽스처: 라이브 /api/open 의 5796115 (축산 단일)
const SINGLE = {
  category: '축산', categories: ['축산'], floorRate: 90,
  band: { n: 5, dense: { lo: 90.191, hi: 90.291, pct: 20 } },   // 전 품목 합산
  recent3: [90.19, 92.4, 96.23], nSameFloor: 5,
  byCat: { 축산: { band: { n: 1, dense: { lo: 90.725, hi: 90.825, pct: 100 } }, recent3: [90.725], nSameFloor: 1 } },
};

test('품목이 하나면 그 품목 값을 쓴다', () => {
  const p = pickBand(SINGLE);
  expect(p.band?.dense?.lo).toBe(90.725);   // 전 품목(90.191)이 아니다
  expect(p.recent3).toEqual([90.725]);
  expect(p.n).toBe(1);
  expect(p.category).toBe('축산');
});

test('다품목이면 전 품목 합산이고 그 사실을 밝힌다', () => {
  const p = pickBand({ ...SINGLE, categories: ['축산', '농산'] });
  expect(p.band?.dense?.lo).toBe(90.191);
  expect(p.category).toBeNull();
  expect(bandBasisText(p)).toBe('전 품목 합산 · 하한 90 · 5회 중 20%');
});

test('품목별 값이 없으면 전 품목으로 떨어진다', () => {
  const p = pickBand({ ...SINGLE, byCat: null });
  expect(p.band?.dense?.lo).toBe(90.191);
  expect(p.category).toBeNull();
});

test('근거를 표본까지 밝힌다', () => {
  expect(bandBasisText(pickBand(SINGLE))).toBe('축산 · 하한 90 · 1회 중 100%');
});
