import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Button, buttonVariants } from './button';

describe('공통 버튼 상호작용', () => {
  test('기본 버튼은 공통 press 피드백을 사용하고 클릭 행동을 주입받는다', async () => {
    const calls: string[] = [];
    const screen = render(<Button onClick={() => calls.push('실행')}>저장</Button>);
    const button = screen.getByRole('button', { name: '저장' });

    expect(button.getAttribute('data-interaction')).toBe('press');
    await userEvent.click(button);
    expect(calls).toEqual(['실행']);
  });

  test('link와 명시적인 quiet 버튼은 위치가 움직이지 않는 상호작용을 사용한다', () => {
    const screen = render(
      <>
        <Button variant='link'>도움말</Button>
        <Button interaction='quiet'>고정 동작</Button>
      </>
    );

    expect(screen.getByRole('button', { name: '도움말' }).getAttribute('data-interaction')).toBe(
      'quiet'
    );
    expect(screen.getByRole('button', { name: '고정 동작' }).getAttribute('data-interaction')).toBe(
      'quiet'
    );
  });

  test('누름은 공통 pressable 하나가 맡고 popup·움직임 줄이기 처리는 그 안에 있다', () => {
    const className = buttonVariants({ interaction: 'press' });

    expect(className).toContain('pressable');
    expect(className).not.toContain('transition-all');
    expect(className).not.toContain('translate-y-px');
  });

  test('기본 단추는 48px·17px·bold이고 어떤 크기도 40px 아래로 내려가지 않는다', () => {
    expect(buttonVariants()).toContain('h-12');
    expect(buttonVariants()).toContain('text-body');
    expect(buttonVariants()).toContain('font-bold');
    for (const size of ['xs', 'sm', 'icon', 'icon-xs', 'icon-sm'] as const) {
      expect(buttonVariants({ size })).toMatch(/(?:^|\s)(?:h|size)-10(?:\s|$)/);
    }
  });
});
