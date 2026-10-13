import { describe, expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';

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

  test('자리마다 eaT에 넣는 사정률이 크게 복사 표시와 함께 보이고 목록 위에 접힌 읽는 법이 있다', () => {
    // 아버지는 금액이 아니라 사정률을 넣는다. 숫자 자체가 단추라는 것은 눈으로 알 수 없어 복사 표시를 늘 보인다.
    const { container, getByText } = render(<BidBoardList view={view} />);
    const amountCells = [...container.querySelectorAll('[data-cell="amounts"]')];
    expect(amountCells.length).toBeGreaterThan(0);
    for (const cell of amountCells) {
      const figures = cell.querySelectorAll('[data-slot="bid-figure"]');
      expect(figures.length).toBeGreaterThan(0);
      expect(cell.querySelectorAll('[data-slot="copy-chip"]').length).toBe(figures.length);
    }
    expect(amountCells[0]!.textContent).toContain('사정률');
    expect(amountCells[0]!.textContent).toContain('98.490');
    expect(amountCells[0]!.textContent).toContain('88.641%');
    expect(getByText('이 화면 읽는 법').tagName).toBe('SUMMARY');
  });

  test('더 보기는 성적을 맨 위에 두고 그 아래 맞춤 더 보기와 전국 공식 더 보기를 칸 순서대로 둔다', () => {
    const { container } = render(<BidBoardList view={view} />);
    const more = container.querySelector('[data-slot="bid-board-row"] details')!;
    const titles = [...more.querySelectorAll('h4')].map((title) => title.textContent);
    expect(titles).toEqual(['성적 · 지난 공고 1,838건', '10월 맞춤 더 보기', '전국 공식 더 보기']);
    expect(more.textContent).toContain('그동안 낸 금액');
    // 성적 숫자는 잰 기간·계산 판과, 전국 공식 금액은 규칙 판·검증 기간과 함께 보여야 한다(AGENTS 7).
    expect(more.textContent).toContain('2024년 4월~2026년 9월 공고에 1번·2번을 넣었다고 치고 센 낙찰 수예요(예정가격 추첨 평균 · 계산 2026-10-10).');
    expect(more.textContent).toContain('전국 공식 2026-10-10 규칙 · 2025-12까지 배우고 2026-01~2026-08로 검증했어요.');
  });

  test('폰에서는 근거가 가장 강한 칸을 먼저 두고 다른 방법은 접어 두며, 넓은 화면에서는 열 순서를 되돌린다', () => {
    const { container, getAllByRole } = render(<BidBoardList view={view} />);
    const row = container.querySelector('[data-slot="bid-board-row"]')!;
    const cells = [...row.querySelectorAll('[data-slot="bid-board-cell"]')];
    expect(cells[0]!.getAttribute('aria-label')).toBe('10월 맞춤, 지금 근거가 가장 강한 방법');
    expect(cells.map((cell) => cell.className.match(/sm:order-\d/)?.[0])).toEqual(['sm:order-1', 'sm:order-2']);
    const fold = row.querySelector('[data-slot="bid-board-fold"]')!;
    expect(fold.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'sm:contents']));
    const toggle = getAllByRole('button', { name: '다른 방법 1개 보기' })[0]!;
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(fold.className.split(/\s+/)).toContain('grid');
  });

  test('공고번호가 있으면 행에 복사 손잡이와 함께 보이고, 모든 칸이 같은 이유로 빈 행은 한 줄로 말한다', () => {
    const withNumber = presentBidBoard({ ...board, rows: [{ ...board.rows[0]!, displayBidNo: '2026-0001' }] } as typeof board);
    if (withNumber.kind !== 'board') throw new Error('목록이어야 한다');
    const numbered = render(<BidBoardList view={withNumber} />);
    expect(numbered.getByRole('button', { name: /공고번호 2026-0001/ })).toBeTruthy();
    numbered.unmount();
    const { container } = render(<BidBoardList view={view} />);
    const shared = [...container.querySelectorAll('[data-slot="bid-board-shared-reason"]')].map((node) => node.textContent);
    expect(shared).toContain('기초금액이 아직 안 나와 금액을 내지 않았어요');
  });
});
