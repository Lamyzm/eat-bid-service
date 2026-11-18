import { describe, expect, test } from 'bun:test';

import type { BidBoardRowWire, MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import {
  board,
  boardRows,
  kst,
  marketPickHead,
  notices90,
  todayOpenRow
} from '@/app/(workspace)/work/__fixtures__/bid-board';
import { floorKind, presentWorkBoard, type BusinessInput, type WorkBoard } from './work-board';

const named = (...labels: string[]): BusinessInput[] =>
  labels.map((label) => ({ supplierLabel: label }));
const boardOf = (
  response: MyBidBoardV1Response,
  businesses: readonly BusinessInput[] = named('오뚜기축산', '신성유통')
): WorkBoard => {
  const view = presentWorkBoard(response, businesses);
  if (view.kind !== 'board') throw new Error('목록이 아니다');
  return view;
};
const withRows = (rows: readonly BidBoardRowWire[]) => ({ ...board, rows }) as MyBidBoardV1Response;

describe('넣을 공고 표시 모델', () => {
  test('기준 시각을 "저녁 7시"처럼 쓰고 달 이름을 붙인다', () => {
    const view = boardOf(board);
    expect(view.asOfText).toBe('10월 21일 (수) 저녁 7시');
    expect(view.monthLabel).toBe('10월 값');
  });

  test('마감일 칩은 내일부터이고 오늘 마감은 아직 열려 있어도 빼며 주가 바뀌는 자리를 표시한다', () => {
    const view = boardOf(withRows([todayOpenRow, ...board.rows]));
    expect(view.days.map((day) => [day.label, day.count, day.weekBreak])).toEqual([
      ['내일 22일 (목)', 19, false],
      ['23일 (금)', 16, false],
      ['26일 (월)', 17, true],
      ['27일 (화)', 2, false],
      ['28일 (수)', 1, false]
    ]);
  });

  test('달이 바뀐 마감일 칩에는 달을 붙인다', () => {
    const november = { ...notices90[0]!, auctionId: '2899999', closesAt: '2026-11-02T01:00:00Z' };
    expect(boardOf(withRows([november])).days.map((day) => day.label)).toEqual(['11월 2일 (월)']);
  });

  test('사업장 둘이면 이달 하한 90% 값은 맞춤 1·2순위를 등록 순서대로 싣는다', () => {
    expect(boardOf(board).month90.map((entry) => [entry.name, entry.value])).toEqual([
      ['오뚜기축산', '88.641'],
      ['신성유통', '89.010']
    ]);
  });

  test('사업장이 다섯이면 셋째부터 예비 순위 값을 같은 순서로 싣고 이름은 잘리지 않게 다 싣는다', () => {
    const view = boardOf(
      board,
      named('오뚜기축산', '신성유통', '한빛정육', '대성미트', '청솔식품')
    );
    expect(view.month90.map((entry) => entry.value)).toEqual([
      '88.641',
      '89.010',
      '88.542',
      '88.740',
      '88.839'
    ]);
    expect(view.month90.map((entry) => entry.name)).toEqual([
      '오뚜기축산',
      '신성유통',
      '한빛정육',
      '대성미트',
      '청솔식품'
    ]);
  });

  test('사업장이 하나면 혼자 넣을 때의 값을 쓴다', () => {
    expect(boardOf(board, named('오뚜기축산')).month90.map((entry) => entry.value)).toEqual([
      '88.641'
    ]);
  });

  test('업체명이 관측되지 않은 사업장은 사업자등록번호가 아니라 순번으로 부른다', () => {
    expect(
      boardOf(board, [{ supplierLabel: null }, {}]).month90.map((entry) => entry.name)
    ).toEqual(['1번 사업장', '2번 사업장']);
  });

  test('88% 공고는 값이 같은 공고끼리 한 묶음이고 묶음 머리에 사업장마다 서버 규칙 값을 싣는다', () => {
    const tomorrow = boardOf(board).days[0]!;
    expect(tomorrow.groups88).toHaveLength(1);
    expect(tomorrow.groups88[0]!.rows.map((row) => row.organization)).toEqual([
      '장유고등학교',
      '통영잠포학교',
      '김해수남고등학교'
    ]);
    expect(tomorrow.groups88[0]!.values.map((entry) => [entry.name, entry.value])).toEqual([
      ['오뚜기축산', '86.724'],
      ['신성유통', '87.164']
    ]);
    expect(tomorrow.rows90).toHaveLength(16);
  });

  test('88% 값이 갈리면 묶음도 나뉘고 규칙이 순위를 내지 않은 사업장은 까닭을 쓴다', () => {
    const fewer = {
      ...boardRows.tongyeongJampo88,
      rule: { state: 'not-applicable' as const, reasons: ['participation-below-rule' as const] }
    };
    const view = boardOf(withRows([boardRows.janggyuHigh88, fewer]), named('가', '나', '다', '라'));
    const groups = view.days[0]!.groups88;
    expect(groups.map((group) => group.rows.map((row) => row.organization))).toEqual([
      ['장유고등학교'],
      ['통영잠포학교']
    ]);
    expect(groups[0]!.values.map((entry) => entry.value ?? entry.reason)).toEqual([
      '86.724',
      '87.164',
      '87.516',
      '값 없음'
    ]);
    expect(groups[1]!.values.map((entry) => entry.reason)).toEqual([
      '참여 업체가 적어요',
      '참여 업체가 적어요',
      '참여 업체가 적어요',
      '참여 업체가 적어요'
    ]);
  });

  test('공고 줄은 마감 시각·학교·공고번호이고 9·10시가 아닌 마감을 따로 표시한다', () => {
    const tomorrow = boardOf(board).days[0]!;
    expect(tomorrow.rows90.slice(0, 2)).toEqual([
      {
        auctionId: '2810100',
        time: '08:00',
        unusualTime: true,
        organization: '김해삼성초등학교',
        bidNo: 'E261015-678192-0'
      },
      {
        auctionId: '2810101',
        time: '09:00',
        unusualTime: false,
        organization: '신문초등학교',
        bidNo: 'E261015-678312-0'
      }
    ]);
  });

  test('하한율을 아직 모르는 공고는 값 없이 미확인 묶음에 둔다', () => {
    const unknown = { ...notices90[0]!, auctionId: '2899998', floorRate: null };
    expect(boardOf(withRows([unknown])).days[0]!.rowsOther.map((row) => row.organization)).toEqual([
      '김해삼성초등학교'
    ]);
  });

  test('맞춤을 고르지 않은 달은 90% 칸에 까닭을 한 문장으로 쓰고 값을 지어내지 않는다', () => {
    const response = {
      ...board,
      marketPick: {
        ...marketPickHead,
        state: 'not-applicable',
        reasons: ['market-rounds-below-minimum']
      },
      rows: [
        {
          ...notices90[0]!,
          market: { state: 'not-applicable', reasons: ['market-rounds-below-minimum'] }
        }
      ]
    } as MyBidBoardV1Response;
    expect(boardOf(response).month90.map((entry) => [entry.value, entry.reason])).toEqual([
      [null, '최근 석 달 공고가 적어요'],
      [null, '최근 석 달 공고가 적어요']
    ]);
  });

  test('오늘 마감 하한 90% 공고만 남아도 이달 값은 판에 싣는다', () => {
    expect(boardOf(withRows([todayOpenRow])).month90.map((entry) => entry.value)).toEqual([
      '88.641',
      '89.010'
    ]);
    expect(boardOf(withRows([todayOpenRow])).days).toEqual([]);
  });

  test('관심 지역을 확인하지 않았으면 목록 대신 그 상태를 돌려준다', () => {
    expect(
      presentWorkBoard({ regionPreference: 'unconfirmed', asOf: board.asOf, rows: [] }, named('가'))
        .kind
    ).toBe('region-unconfirmed');
  });

  test('하한율은 끝의 0만 다른 표기를 같게 보고 88·90 밖은 가르지 않는다', () => {
    expect([
      floorKind('90.000'),
      floorKind('90'),
      floorKind('88.000'),
      floorKind('87.745'),
      floorKind(null)
    ]).toEqual([90, 90, 88, null, null]);
  });

  test('표본의 시각 도우미는 KST 시각을 instant로 옮긴다', () => {
    expect(kst('22', '08:00')).toBe('2026-10-21T23:00:00Z');
  });
});
