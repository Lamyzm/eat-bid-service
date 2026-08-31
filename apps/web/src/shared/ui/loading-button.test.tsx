import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LoadingButton } from './loading-button';

describe('처리 중 버튼', () => {
  test('크기와 focus를 보존하면서 처리 상태를 한국어로 알린다', () => {
    const screen = render(
      <LoadingButton loading loadingLabel='후보 저장 중'>
        후보 저장
      </LoadingButton>
    );
    const button = screen.getByRole('button', { name: '후보 저장' });

    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('tabindex')).toBe('0');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.textContent).toContain('후보 저장');
    const status = screen.getByRole('status');
    expect(button.getAttribute('aria-describedby')).toContain(status.id);
    expect(status.textContent).toBe('후보 저장 중');
  });

  test('처리 중에는 중복 클릭을 막고 완료 뒤에는 주입된 행동을 실행한다', async () => {
    const calls: string[] = [];
    const screen = render(
      <LoadingButton loading onClick={() => calls.push('실행')}>
        저장
      </LoadingButton>
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(calls).toEqual([]);

    screen.rerender(<LoadingButton onClick={() => calls.push('실행')}>저장</LoadingButton>);
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(calls).toEqual(['실행']);
  });
});
