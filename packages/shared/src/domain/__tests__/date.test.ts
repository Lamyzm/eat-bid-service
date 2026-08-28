// 막는 사고: "오늘"이 UTC 기준이라 매일 09시 이전에 하루가 어긋난 것.
// 개찰일·마감일이 전부 한국 날짜여서, 그 시간대에 화면이 어제를 오늘이라고 말했다.
import { expect, test } from 'bun:test';
import { kstDate, daysAgoKST, monthsAgoKST, kstTime, daysBetween } from '../date.js';

// 픽스처: 실제 /api/open 응답의 fetchedAt (UTC 05:56 = KST 14:56)
const FETCHED_AT = '2026-08-28T05:56:42.651Z';

test('UTC 자정~09시 사이에도 한국 날짜를 준다', () => {
  expect(kstDate(Date.parse('2026-08-28T00:30:00Z'))).toBe('2026-08-28'); // KST 09:30
  expect(kstDate(Date.parse('2026-08-27T15:00:00Z'))).toBe('2026-08-28'); // KST 자정 직후
  expect(kstDate(Date.parse('2026-08-27T14:59:59Z'))).toBe('2026-08-27'); // 자정 1초 전
});

test('실제 fetchedAt 을 한국 시각으로 읽는다', () => {
  expect(kstDate(new Date(FETCHED_AT))).toBe('2026-08-28');
  expect(kstTime(new Date(FETCHED_AT))).toBe('14:56');
});

test('n일 전도 같은 기준을 쓴다', () => {
  const at = Date.parse('2026-08-28T00:30:00Z'); // KST 08-28 09:30
  expect(daysAgoKST(1, at)).toBe('2026-08-27');
});

test('n개월 전', () => {
  expect(monthsAgoKST(12, Date.parse('2026-08-28T00:30:00Z'))).toBe('2025-08-28');
});

test('날짜 사이 일수는 시간대에 흔들리지 않는다', () => {
  expect(daysBetween('2026-08-27', '2026-08-28')).toBe(1);
  expect(daysBetween('2026-08-28', '2026-08-28')).toBe(0);
});
