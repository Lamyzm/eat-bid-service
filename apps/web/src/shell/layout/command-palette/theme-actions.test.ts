import { expect, test } from 'bun:test';
import { createThemeActions } from './theme-actions';

test('theme 순환 명령은 현재 palette의 다음 값을 적용한다', () => {
  const applied: string[] = [];
  const actions = createThemeActions({
    theme: 'light',
    activeTheme: 'claude',
    themes: [
      { name: 'Eatbid', value: 'eatbid' },
      { name: 'Claude', value: 'claude' },
      { name: 'Discord', value: 'discord' }
    ],
    setTheme: () => undefined,
    setActiveTheme: (theme) => applied.push(theme)
  });

  actions.find((action) => action.id === 'cycle-theme')?.onSelect();

  expect(applied).toEqual(['discord']);
});

test('명암 전환 명령은 현재 mode의 반대 값을 적용한다', () => {
  const applied: string[] = [];
  const actions = createThemeActions({
    theme: 'dark',
    activeTheme: 'eatbid',
    themes: [{ name: 'Eatbid', value: 'eatbid' }],
    setTheme: (theme) => applied.push(theme),
    setActiveTheme: () => undefined
  });

  actions.find((action) => action.id === 'toggle-theme-mode')?.onSelect();

  expect(applied).toEqual(['light']);
});
