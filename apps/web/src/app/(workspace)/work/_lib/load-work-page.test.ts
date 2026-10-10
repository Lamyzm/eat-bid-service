import { describe, expect, test } from 'bun:test';

import { board } from '@/app/(workspace)/work/__fixtures__/bid-board';
import { loadWorkPage } from './load-work-page';
import { workItemsOf } from './work-search';

const EMPTY = { items: null, itemUnknown: null } as const;
const noConditions = async () => ({ areas: null, businessCount: null });
const gimhae = { codeValueId: '1', code: '48250', scheme: 'eat:participation-restriction-area', label: '경남 김해시' } as const;

describe('오늘 투찰 화면 조립', () => {
  test('주소의 품목 중 계약 어휘만 남겨 조회에 넘긴다', async () => {
    const asked: unknown[] = [];
    await loadWorkPage({ items: ['육류', '가금류', '축산'], itemUnknown: null }, {
      readBoard: async (input) => { asked.push(input); return { kind: 'board', response: board }; },
      readConditions: noConditions
    });
    expect(asked).toEqual([{ items: ['육류', '가금류'], itemUnknown: undefined }]);
    expect(workItemsOf({ items: null, itemUnknown: 'include' })).toEqual({ items: undefined, itemUnknown: 'include' });
  });

  test('권한이 없으면 forbidden, 조회가 실패하면 failed로 말하고 화면 전체를 오류로 만들지 않는다', async () => {
    expect(await loadWorkPage(EMPTY, { readBoard: async () => ({ kind: 'forbidden' }), readConditions: noConditions }))
      .toEqual({ kind: 'forbidden' });
    expect(await loadWorkPage(EMPTY, { readBoard: async () => { throw new Error('서버 장애'); }, readConditions: noConditions }))
      .toEqual({ kind: 'failed' });
  });

  test('응답이 오면 표시 모델로 바꾸고 관심 지역·사업자 수로 조건 요약을 붙인다', async () => {
    const view = await loadWorkPage(EMPTY, {
      readBoard: async () => ({ kind: 'board', response: board }),
      readConditions: async () => ({ areas: [gimhae], businessCount: 2 })
    });
    expect(view.kind).toBe('board');
    expect(view.kind === 'board' ? view.summary : null).toBe('관심 지역 경남 김해시 · 하한율 90%·88% · 내 사업자 2곳');
  });

  test('조건을 읽지 못해도 목록은 그대로 내고 요약에서 그 조각만 뺀다', async () => {
    // 요약은 목록의 범위를 말해 주는 보조 줄이다. 그것 때문에 금액 목록 전체를 실패로 만들지 않는다.
    const view = await loadWorkPage(EMPTY, {
      readBoard: async () => ({ kind: 'board', response: board }),
      readConditions: async () => { throw new Error('조회 실패'); }
    });
    expect(view.kind === 'board' ? view.summary : null).toBe('하한율 90%·88%');
  });
});
