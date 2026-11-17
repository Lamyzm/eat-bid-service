import { describe, expect, test } from 'bun:test';

import type { MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { board, boardRows, marketPickHead } from '@/app/(workspace)/work/__fixtures__/bid-board';
import { floorKind, presentWorkBoard, type BusinessInput, type WorkBoard } from './work-board';

const named = (...labels: string[]) => labels.map((label, index) => ({ businessNumber: `900000003${index}`, supplierLabel: label }));
const boardOf = (response: MyBidBoardV1Response, businesses: readonly BusinessInput[] = named('오뚜기축산', '신성유통')): WorkBoard => {
  const view = presentWorkBoard(response, businesses);
  if (view.kind !== 'board') throw new Error('목록이 아니다');
  return view;
};

describe('넣을 공고 표시 모델', () => {
  test('사업장 둘이면 맞춤 1·2순위 값을 등록 순서대로 카드에 싣고 달 이름을 붙인다', () => {
    const view = boardOf(board);
    expect(view.monthLabel).toBe('10월 값');
    expect(view.cards.map((card) => [card.name, card.value90])).toEqual([['오뚜기축산', '88.641'], ['신성유통', '89.028']]);
  });

  test('사업장이 다섯이면 셋째부터는 예비 순위 값을 같은 순서로 싣는다', () => {
    const view = boardOf(board, named('가', '나', '다', '라', '마'));
    expect(view.cards.map((card) => card.value90)).toEqual(['88.641', '89.028', '88.542', '88.740', '88.839']);
  });

  test('사업장이 하나면 혼자 넣을 때의 값을 쓴다', () => {
    expect(boardOf(board, named('오뚜기축산')).cards.map((card) => card.value90)).toEqual(['88.641']);
  });

  test('업체명이 관측되지 않은 사업장은 사업자등록번호로 부른다', () => {
    const view = boardOf(board, [{ businessNumber: '9000000035', supplierLabel: null }]);
    expect(view.cards[0]!.name).toBe('900-00-00035');
  });

  test('공고를 마감일로 묶고 날마다 88%·90%·미확인 묶음으로 나눈다', () => {
    const view = boardOf(board);
    expect(view.asOfText).toBe('9월 22일 (화) 09:47');
    expect(view.days.map((day) => [day.label, day.count, day.rows88.length, day.rows90.length])).toEqual([
      ['오늘 9.22(화)', 6, 1, 5],
      ['내일 9.23(수)', 1, 0, 1]
    ]);
    const today = view.days[0]!;
    expect(today.rows90.map((row) => row.time)).toEqual(['10:00', '10:00', '10:00', '10:00', '15:10']);
    expect(today.rows90.find((row) => row.time === '15:10')?.unusualTime).toBe(true);
  });

  test('88% 공고는 줄마다 전국 공식의 순위 값을 싣고 낼 수 없는 칸은 비운다', () => {
    const applicable88 = { ...boardRows.tongyeong, auctionId: '2797099', floorRate: { value: '88.000', unit: 'percentage-points' as const } };
    const view = boardOf({ ...board, rows: [boardRows.gubong88, applicable88] } as MyBidBoardV1Response, named('가', '나', '다'));
    const rows = view.days[0]!.rows88;
    expect(rows.map((row) => row.values)).toEqual([[null, null, null], ['88.515', '89.010', null]]);
  });

  test('넘겨주기 글에는 이름·달·90% 값과 그 사업장의 88% 공고 값을 담는다', () => {
    const applicable88 = { ...boardRows.tongyeong, auctionId: '2797099', floorRate: { value: '88.000', unit: 'percentage-points' as const } };
    const view = boardOf({ ...board, rows: [boardRows.juchon, applicable88] } as MyBidBoardV1Response);
    expect(view.cards[1]!.passText).toBe('신성유통 10월 값\n하한 90%: 89.028%\n하한 88%:\n  9.22 통영여자고등학교 89.010%');
  });

  test('맞춤을 고르지 않은 달은 90% 카드에 까닭을 한 문장으로 쓰고 값을 지어내지 않는다', () => {
    const response = {
      ...board,
      marketPick: { ...marketPickHead, state: 'not-applicable', reasons: ['market-rounds-below-minimum'] },
      rows: [{ ...boardRows.juchon, market: { state: 'not-applicable', reasons: ['market-rounds-below-minimum'] } }]
    } as MyBidBoardV1Response;
    expect(boardOf(response).cards.map((card) => [card.value90, card.reason90])).toEqual([
      [null, '최근 석 달 공고가 적어요'],
      [null, '최근 석 달 공고가 적어요']
    ]);
  });

  test('관심 지역을 확인하지 않았으면 목록 대신 그 상태를 돌려준다', () => {
    expect(presentWorkBoard({ regionPreference: 'unconfirmed', asOf: board.asOf, rows: [] }, named('가')).kind).toBe('region-unconfirmed');
  });

  test('하한율은 끝의 0만 다른 표기를 같게 보고 88·90 밖은 가르지 않는다', () => {
    expect([floorKind('90.000'), floorKind('90'), floorKind('88.000'), floorKind('87.745'), floorKind(null)]).toEqual([90, 90, 88, null, null]);
  });
});
