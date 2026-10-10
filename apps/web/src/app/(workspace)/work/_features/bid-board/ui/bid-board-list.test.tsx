import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { board } from '@/app/(workspace)/work/__fixtures__/bid-board';
import { presentBidBoard } from '../model/present-bid-board';
import { BidBoardList } from './bid-board-list';

const view = presentBidBoard(board);
if (view.kind !== 'board') throw new Error('표본은 관심 지역이 확인된 응답이다');

describe('오늘 투찰 목록 칸', () => {
  test('좁은 화면에서도 금액 칸과 이유 칸마다 방법 이름이 보인다', () => {
    // 칸 머리줄(10월 맞춤·전국 공식)은 넓은 화면에서만 보인다. 좁은 화면에서 칸이 세로로 쌓이면 칸 안의 이름만이 어느 방법인지 말한다.
    const { container } = render(<BidBoardList view={view} />);
    const cells = [...container.querySelectorAll('[data-slot="bid-board-cell"]')];
    expect(cells.length).toBeGreaterThan(0);
    const kinds = new Set(cells.map((cell) => cell.getAttribute('data-cell')));
    expect([...kinds].toSorted()).toEqual(['amounts', 'reason']);
    for (const cell of cells) {
      const name = cell.querySelector('[data-slot="bid-board-cell-method"]');
      expect(name?.textContent).toMatch(/^(9월 맞춤|10월 맞춤|전국 공식)/);
      const classes = name!.className.split(/\s+/);
      expect(classes).not.toContain('sr-only');
      expect(classes).not.toContain('hidden');
    }
  });
});
