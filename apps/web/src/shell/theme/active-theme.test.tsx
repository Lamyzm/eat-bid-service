import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';

import { ActiveThemeProvider, useThemeConfig } from './active-theme';

function ThemeProbe() {
  const { activeTheme } = useThemeConfig();
  return <output data-testid='active-theme'>{activeTheme}</output>;
}

describe('색상 theme provider(ActiveThemeProvider)', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('data-theme');
  });

  test('첫 mount에서는 inline script가 cookie로 설정한 DOM data-theme을 state로 채택한다', async () => {
    document.documentElement.setAttribute('data-theme', 'claude');

    const screen = render(
      <ActiveThemeProvider>
        <ThemeProbe />
      </ActiveThemeProvider>
    );

    await waitFor(() => expect(screen.getByTestId('active-theme').textContent).toBe('claude'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('claude');
    expect(document.cookie).toContain('active_theme=claude');
  });

  test('DOM data-theme이 허용 목록 밖이면 기본 theme으로 되돌리고 cookie를 다시 쓴다', async () => {
    document.documentElement.setAttribute('data-theme', 'bogus');

    const screen = render(
      <ActiveThemeProvider>
        <ThemeProbe />
      </ActiveThemeProvider>
    );

    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('toss'));
    expect(screen.getByTestId('active-theme').textContent).toBe('toss');
    expect(document.cookie).toContain('active_theme=toss');
  });
});
