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

  test('focus를 지연하지 않고 popup과 reduced motion에서 위치 이동을 막는다', () => {
    const className = buttonVariants({ interaction: 'press' });

    expect(className).toContain(
      'transition-[color,background-color,border-color,opacity,transform]'
    );
    expect(className).not.toContain('transition-all');
    expect(className).not.toContain('box-shadow');
    expect(className).toContain('not-aria-[haspopup]');
    expect(className).toContain('motion-reduce:transform-none');
  });
});
