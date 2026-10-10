import { describe, expect, test } from 'bun:test';
import type { MyBidBoardV1Response } from '@eatbid/contracts/api/v1/me';

import { findBannedCopy } from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/banned-copy';
import { board, boardRows, marketPickHead } from '@/app/(workspace)/work/__fixtures__/bid-board';
import { presentBidBoard, type BoardView } from './present-bid-board';

type Confirmed = Extract<MyBidBoardV1Response, { regionPreference: 'confirmed' }>;

function boardView(response: MyBidBoardV1Response = board) {
  const view = presentBidBoard(response);
  if (view.kind !== 'board') throw new Error('목록이어야 한다');
  return view;
}

const withRows = (rows: Confirmed['rows'], overrides: Partial<Confirmed> = {}): MyBidBoardV1Response =>
  ({ ...(board as Confirmed), rows, ...overrides });

const rowOf = (view: ReturnType<typeof boardView>, auctionId: string) =>
  view.groups.flatMap((group) => group.rows).find((row) => row.auctionId === auctionId)!;

describe('오늘 투찰 표시', () => {
  test('공고를 KST 마감 시각으로 묶고 마감 순으로 세우며 내일 묶음에는 내일을 붙인다', () => {
    const view = boardView();
    expect(view.groups.map((group) => [group.label, group.relative, group.rows.length])).toEqual([
      ['오전 10시 마감', '13분 뒤', 5],
      ['오후 3시 10분 마감', '5시간 23분 뒤', 1],
      ['내일 · 오전 9시 마감', '내일', 1]
    ]);
    expect(view.lede).toBe('오늘 마감 6건, 내일 마감 1건이에요.');
    expect(view.stamp).toBe('09:47 기준 · 10월 맞춤 금액은 7~9월 내 사업자 공고 164건으로 골랐어요');
  });

  test('열 머리는 같은 공고에 대어 본 낙찰 수를 소수 오차 없이 더해 쓴다', () => {
    const view = boardView();
    expect(view.columns).toEqual([
      { label: '10월 맞춤', record: '95.0건' },
      { label: '전국 공식', record: '81.9건' }
    ]);
    expect(view.columnCaption).toBe('같은 공고 1,838건에 대어 본 낙찰 수(두 장)');
  });

  test('맞춤이 나온 행은 맞춤 칸에 근거 표시를 두고 전국 공식은 옆에 그대로 둔다', () => {
    const row = rowOf(boardView(), '2797001');
    expect(row.cells).toEqual([
      {
        kind: 'amounts',
        lead: true,
        lines: [
          { label: '1번', amount: '13,304,243원', copyValue: '13304243' },
          { label: '2번', amount: '13,362,329원', copyValue: '13362329' }
        ]
      },
      {
        kind: 'amounts',
        lead: false,
        lines: [
          { label: '1번', amount: '13,285,332원', copyValue: '13285332' },
          { label: '2번', amount: '13,359,627원', copyValue: '13359627' }
        ]
      }
    ]);
    expect(row.facts).toBe('기초금액 15,009,130원 · 참여 93곳');
    expect(row.more.single).toEqual({ label: '한 곳만 넣을 때', amount: '13,304,243원', copyValue: '13304243', note: '이번 달은 1번과 같은 금액' });
    expect(row.more.spares.map((spare) => [spare.label, spare.amount])).toEqual([
      ['예비 3순위', '13,289,384원'],
      ['예비 4순위', '13,319,102원'],
      ['예비 5순위', '13,333,962원']
    ]);
    expect(row.more.band).toBe('전국 공식은 참여 70곳 이상 표를 썼어요');
  });

  test('하한율 88 행은 금액 없이 직접 판단으로 표시한다', () => {
    const row = rowOf(boardView(), '2797004');
    expect(row.selfJudged).toBe(true);
    expect(row.cells).toEqual([]);
    expect(JSON.stringify(row)).not.toContain('원"');
  });

  test('기초금액이 없는 행은 두 칸 모두 기초금액 미확인이라고 말한다', () => {
    const row = rowOf(boardView(), '2797005');
    expect(row.cells).toEqual([{ kind: 'reason', text: '기초금액 미확인' }, { kind: 'reason', text: '기초금액 미확인' }]);
    expect(row.facts).toBe('기초금액 미확인 · 참여 43곳');
  });

  test('참여 수를 아직 모르면 전국 공식 칸만 그렇게 말하고 맞춤 금액이 근거 표시를 갖는다', () => {
    const row = rowOf(boardView(), '2797007');
    expect(row.cells[0]).toMatchObject({ kind: 'amounts', lead: true });
    expect(row.cells[1]).toEqual({ kind: 'reason', text: '참여 수 미확인' });
    expect(row.facts).toBe('기초금액 5,598,590원 · 참여 미확인');
  });

  test('맞춤 시장 조회가 실패하면 맞춤 칸만 계산하지 못했다고 하고 전국 공식이 근거 표시를 갖는다', () => {
    const unavailable = withRows(
      [{ ...boardRows.tongyeong, market: { state: 'not-applicable', reasons: ['market-data-unavailable'] } }],
      { marketPick: { ...marketPickHead, state: 'not-applicable', reasons: ['market-data-unavailable'], marketRounds: null, linkedBusinesses: 0 } }
    );
    const view = boardView(unavailable);
    const row = view.groups[0]!.rows[0]!;
    expect(row.cells[0]).toEqual({ kind: 'reason', text: '지금은 계산하지 못했어요' });
    expect(row.cells[1]).toMatchObject({ kind: 'amounts', lead: true });
    expect(view.stamp).toBe('09:47 기준 · 지금은 맞춤 금액을 계산하지 못했어요. 잠시 뒤 새로고침해 주세요.');
  });

  test('관심 지역을 확인하지 않았으면 목록 대신 지역 설정 안내 상태다', () => {
    expect(presentBidBoard({ regionPreference: 'unconfirmed', asOf: '2026-09-22T00:47:00Z', rows: [] }))
      .toEqual({ kind: 'region-unconfirmed' });
  });

  test('오늘·내일 마감 공고가 없으면 빈 목록이라고 말한다', () => {
    const view = boardView(withRows([]));
    expect(view.groups).toEqual([]);
    expect(view.lede).toBe('오늘·내일 마감 공고가 없어요.');
  });

  test('화면 문구는 NeaT 입력 지시·단정·반사실 같은 금지 문형을 쓰지 않는다', () => {
    const views: BoardView[] = [
      presentBidBoard(board),
      presentBidBoard(withRows([{ ...boardRows.tongyeong, market: { state: 'not-applicable', reasons: ['no-linked-business'] } }])),
      presentBidBoard({ regionPreference: 'unconfirmed', asOf: '2026-09-22T00:47:00Z', rows: [] })
    ];
    for (const view of views) expect(findBannedCopy(JSON.stringify(view))).toEqual([]);
  });
});
