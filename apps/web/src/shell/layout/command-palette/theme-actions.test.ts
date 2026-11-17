import { expect, test } from 'bun:test';
import { createThemeActions } from './theme-actions';

test('명암 전환 명령은 현재 mode의 반대 값을 적용한다', () => {
  const applied: string[] = [];
  const actions = createThemeActions({ theme: 'dark', setTheme: (theme) => applied.push(theme) });

  actions.find((action) => action.id === 'toggle-theme-mode')?.onSelect();

  expect(applied).toEqual(['light']);
});

test('색 테마를 고르는 명령은 없다', () => {
  const actions = createThemeActions({ theme: 'light', setTheme: () => undefined });

  expect(actions.map((action) => action.id)).toEqual([
    'toggle-theme-mode',
    'set-light-theme',
    'set-dark-theme'
  ]);
});
