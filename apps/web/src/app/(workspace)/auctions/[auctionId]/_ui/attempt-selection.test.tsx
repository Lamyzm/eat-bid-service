import { describe, expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { attemptsFixture } from '../__fixtures__/attempts';
import { attemptKeys, presentHistory } from '../_model/attempt-history';
import { AttemptSelectionProvider, useAttemptSelection } from './attempt-selection';

const rows = presentHistory(attemptsFixture, null).rows;
function Controls() {
  const state = useAttemptSelection();
  return (
    <>
      <button onClick={() => state.select(rows[0]!.attemptId)}>선택</button>
      <button onClick={state.close}>닫기</button>
      <button onClick={state.openCurrent}>현재 공고</button>
      <button onClick={state.openRecord}>기록 다시 열기</button>
      <output>
        {state.attempt?.attemptId ?? '없음'} / {state.panel ?? '닫힘'}
      </output>
    </>
  );
}
describe('선택 회차와 보조 패널', () => {
  test('패널을 닫거나 현재 공고를 열어도 선택 회차를 유지하고 기록을 다시 연다', () => {
    const screen = render(
      <AttemptSelectionProvider attempts={attemptKeys(rows)}>
        <Controls />
      </AttemptSelectionProvider>
    );
    fireEvent.click(screen.getByText('선택'));
    expect(screen.getByRole('status').textContent).toBe(`${rows[0]!.attemptId} / record`);
    fireEvent.click(screen.getByText('닫기'));
    expect(screen.getByRole('status').textContent).toBe(`${rows[0]!.attemptId} / 닫힘`);
    fireEvent.click(screen.getByText('현재 공고'));
    expect(screen.getByRole('status').textContent).toBe(`${rows[0]!.attemptId} / current`);
    fireEvent.click(screen.getByText('기록 다시 열기'));
    expect(screen.getByRole('status').textContent).toBe(`${rows[0]!.attemptId} / record`);
  });
  test('조회에서 제외된 선택은 닫히고 조건을 되돌려도 되살아나지 않는다', () => {
    const screen = render(
      <AttemptSelectionProvider attempts={attemptKeys(rows)}>
        <Controls />
      </AttemptSelectionProvider>
    );
    fireEvent.click(screen.getByText('선택'));
    screen.rerender(
      <AttemptSelectionProvider attempts={[]}>
        <Controls />
      </AttemptSelectionProvider>
    );
    expect(screen.getByRole('status').textContent).toBe('없음 / 닫힘');
    screen.rerender(
      <AttemptSelectionProvider attempts={attemptKeys(rows)}>
        <Controls />
      </AttemptSelectionProvider>
    );
    fireEvent.click(screen.getByText('기록 다시 열기'));
    expect(screen.getByRole('status').textContent).toBe('없음 / 닫힘');
  });
});
