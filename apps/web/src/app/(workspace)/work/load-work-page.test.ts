import { describe, expect, test } from 'bun:test';

import type { MyBusinessesV1Response } from '@eatbid/contracts/api/v1/me';

import { board } from '@/app/(workspace)/work/__fixtures__/bid-board';
import { loadWorkPage } from './load-work-page';

const listed = (labels: readonly string[]) => async () => ({
  kind: 'businesses' as const,
  response: {
    businesses: labels.map((label, index) => ({
      businessId: String(index + 1),
      businessNumber: `900000003${index}`,
      registeredAt: '2026-09-09T00:00:00Z',
      supplier: { kind: 'unobserved' as const },
      location: null,
      supplierLabel: label
    }))
  } as MyBusinessesV1Response
});
const readBoard = async () => ({ kind: 'board' as const, response: board });

describe('넣을 공고 화면 조립', () => {
  test('권한이 없으면 forbidden, 조회가 실패하면 failed로 말하고 화면 전체를 오류로 만들지 않는다', async () => {
    expect(
      await loadWorkPage({
        readBoard: async () => ({ kind: 'forbidden' }),
        readBusinesses: listed(['가'])
      })
    ).toEqual({ kind: 'forbidden' });
    expect(
      await loadWorkPage({
        readBoard: async () => {
          throw new Error('서버 장애');
        },
        readBusinesses: listed(['가'])
      })
    ).toEqual({ kind: 'failed' });
  });

  test('등록한 사업장이 없으면 값 판 대신 그 상태를 말한다', async () => {
    expect(await loadWorkPage({ readBoard, readBusinesses: listed([]) })).toEqual({
      kind: 'no-business'
    });
  });

  test('사업장 목록을 못 읽어도 값은 감추지 않고 순번으로 부른다', async () => {
    const view = await loadWorkPage({
      readBoard,
      readBusinesses: async () => {
        throw new Error('조회 실패');
      }
    });
    expect(
      view.kind === 'board' ? view.month90.map((entry) => [entry.name, entry.value]) : null
    ).toEqual([
      ['1번 사업장', '88.641'],
      ['2번 사업장', '89.010']
    ]);
  });

  test('응답과 사업장 목록이 오면 등록 순서대로 사업장 값을 싣는다', async () => {
    const view = await loadWorkPage({
      readBoard,
      readBusinesses: listed(['오뚜기축산', '신성유통'])
    });
    expect(view.kind === 'board' ? view.month90.map((entry) => entry.name) : null).toEqual([
      '오뚜기축산',
      '신성유통'
    ]);
  });
});
