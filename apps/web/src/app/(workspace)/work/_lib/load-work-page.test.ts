import { describe, expect, test } from 'bun:test';

import { board } from '@/app/(workspace)/work/__fixtures__/bid-board';
import { loadWorkPage } from './load-work-page';
import { workItemsOf } from './work-search';

describe('오늘 투찰 화면 조립', () => {
  test('주소의 품목 중 계약 어휘만 남겨 조회에 넘긴다', async () => {
    const asked: unknown[] = [];
    await loadWorkPage({ items: ['육류', '가금류', '축산'], itemUnknown: null }, {
      readBoard: async (input) => { asked.push(input); return { kind: 'board', response: board }; }
    });
    expect(asked).toEqual([{ items: ['육류', '가금류'], itemUnknown: undefined }]);
    expect(workItemsOf({ items: null, itemUnknown: 'include' })).toEqual({ items: undefined, itemUnknown: 'include' });
  });

  test('권한이 없으면 forbidden, 조회가 실패하면 failed로 말하고 화면 전체를 오류로 만들지 않는다', async () => {
    expect(await loadWorkPage({ items: null, itemUnknown: null }, { readBoard: async () => ({ kind: 'forbidden' }) }))
      .toEqual({ kind: 'forbidden' });
    expect(await loadWorkPage({ items: null, itemUnknown: null }, { readBoard: async () => { throw new Error('서버 장애'); } }))
      .toEqual({ kind: 'failed' });
  });

  test('응답이 오면 표시 모델로 바꾼다', async () => {
    const view = await loadWorkPage({ items: null, itemUnknown: null }, { readBoard: async () => ({ kind: 'board', response: board }) });
    expect(view.kind).toBe('board');
  });
});
