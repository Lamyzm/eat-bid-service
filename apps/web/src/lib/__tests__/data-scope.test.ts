// 막는 사고: 규모 문구가 세 파일에 복사돼 세 숫자가 전부 틀렸던 것.
// 그리고 추정치(bidCountApprox)를 실측처럼 단언하던 자리.
import { expect, test } from 'bun:test';
import { dataScopeText } from '../../components/data-scope';

// 픽스처: 라이브 /api/stats 실응답
const LIVE = { auctionCount: 181294, bidCountApprox: 9147891, openedFrom: '2023-09-01', openedTo: '2026-08-27' };

test('기간과 함께 말하고, 추정치는 추정이라 밝힌다', () => {
  expect(dataScopeText(LIVE)).toBe('2023-09 ~ 2026-08 · 공고 18.1만 건 · 투찰 약 915만 건');
});

test('근거가 없으면 규모를 주장하지 않는다', () => {
  expect(dataScopeText(null)).toBe('공공 개찰 결과를 정리해 보여줍니다.');
});
