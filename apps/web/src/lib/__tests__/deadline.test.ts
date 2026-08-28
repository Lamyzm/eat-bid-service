// 막는 사고: 마감 표시가 세 화면에 복사돼 있던 것.
// 곧 기준이 개찰 시각 → 실제 마감(1시간 이르다)으로 바뀌는데, 사본이 셋이면
// 하나를 빠뜨려 그 화면만 1시간 틀린 채 남는다. 사장이 투찰을 놓친다.
import { expect, test } from 'bun:test';
import { deadlineText, isClosed, hoursLeft } from '../deadline';

const NOW = Date.parse('2026-08-28T04:00:00Z'); // KST 13:00
const at = (iso: string) => Date.parse(iso);

test('하루 미만은 시간, 하루 이상은 D-n', () => {
  expect(deadlineText(new Date(at('2026-08-28T05:00:00Z')).toISOString(), NOW)).toBe('마감 1시간 전');
  expect(deadlineText(new Date(at('2026-08-29T04:00:00Z')).toISOString(), NOW)).toBe('마감 D-1');
  expect(deadlineText(new Date(at('2026-08-31T04:00:00Z')).toISOString(), NOW)).toBe('마감 D-3');
});

test('경계 — 24시간 직전은 시간, 24시간은 D-1', () => {
  expect(deadlineText(new Date(NOW + 23.99 * 36e5).toISOString(), NOW)).toBe('마감 23시간 전');
  expect(deadlineText(new Date(NOW + 24 * 36e5).toISOString(), NOW)).toBe('마감 D-1');
});

test('한 시간이 안 남으면 0시간 전으로 나온다', () => {
  // 실제 마감(BID_END_DT)이 개찰보다 1시간 이르므로, 지금 이 표시가 나오는 공고는
  // 기준이 바뀌면 '마감됨'으로 넘어간다. 그 전환이 여기서 잡힌다.
  expect(deadlineText(new Date(NOW + 30 * 60_000).toISOString(), NOW)).toBe('마감 0시간 전');
});

test('이미 지난 공고', () => {
  const past = new Date(NOW - 60_000).toISOString();
  expect(deadlineText(past, NOW)).toBe('마감됨');
  expect(isClosed(past, NOW)).toBe(true);
  expect(isClosed(new Date(NOW + 60_000).toISOString(), NOW)).toBe(false);
});

test('값이 없거나 깨졌으면 문장을 만들지 않는다', () => {
  expect(deadlineText(null, NOW)).toBeNull();
  expect(deadlineText('없는날짜', NOW)).toBeNull();
  expect(hoursLeft(null, NOW)).toBeNull();
});

test('남은 시간(시) — 마감 경고 문턱 판정용', () => {
  expect(hoursLeft(new Date(NOW + 3 * 36e5).toISOString(), NOW)).toBe(3);
  expect(hoursLeft(new Date(NOW - 36e5).toISOString(), NOW)).toBe(-1);
});
