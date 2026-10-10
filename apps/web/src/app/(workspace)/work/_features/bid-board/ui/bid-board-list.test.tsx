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

  test('금액마다 복사 표시가 보이고 목록 아래에 읽는 법이 있다', () => {
    // 금액 자체가 단추라는 것은 눈으로 알 수 없다. 복사 표시가 없으면 일곱 자리 금액을 손으로 옮겨 치게 된다.
    const { container, getByRole } = render(<BidBoardList view={view} />);
    const amountCells = [...container.querySelectorAll('[data-cell="amounts"]')];
    expect(amountCells.length).toBeGreaterThan(0);
    for (const cell of amountCells) {
      const lines = cell.querySelectorAll('button');
      expect(cell.querySelectorAll('[data-slot="copy-chip"]').length).toBe(lines.length);
    }
    expect(getByRole('heading', { name: '읽는 법' })).toBeTruthy();
  });

  test('더 보기에는 맞춤 더 보기와 같은 공고에 대어 본 성적 막대가 함께 있다', () => {
    const { container } = render(<BidBoardList view={view} />);
    const more = container.querySelector('[data-slot="bid-board-row"] details')!;
    const titles = [...more.querySelectorAll('h4')].map((title) => title.textContent);
    expect(titles).toEqual(['10월 맞춤 더 보기', '성적 · 같은 공고 1,838건']);
    expect(more.textContent).toContain('그동안 낸 금액');
    // 성적 숫자는 잰 기간·계산 판과, 전국 공식 금액은 규칙 판·검증 기간과 함께 보여야 한다(AGENTS 7).
    expect(more.textContent).toContain('2024년 4월~2026년 9월 공고 · 두 장, 예정가격 추첨 평균 · 계산 판 2026-10-10');
    expect(more.textContent).toContain('전국 공식 규칙 2026-10-10 · 학습 ~2025-12 · 검증 2026-01~2026-08');
  });
});
