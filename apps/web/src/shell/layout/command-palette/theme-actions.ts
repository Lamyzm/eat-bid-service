/** @module 책임: 밝게·어둡게 전환을 실행 가능한 명령 action으로 바꾼다. 색 테마는 하나뿐이라 고르는 명령이 없다(#240). */
import type { CommandPaletteAction } from './context';

interface CreateThemeActionsInput {
  theme: string | undefined;
  setTheme: (theme: string) => void;
}

export function createThemeActions({
  theme,
  setTheme
}: CreateThemeActionsInput): CommandPaletteAction[] {
  return [
    {
      id: 'toggle-theme-mode',
      label: '명암 모드 전환',
      description: '밝은 모드와 어두운 모드를 전환합니다',
      group: '테마',
      shortcut: ['d', 'd'],
      onSelect: () => setTheme(theme === 'light' ? 'dark' : 'light')
    },
    {
      id: 'set-light-theme',
      label: '밝은 모드 사용',
      group: '테마',
      onSelect: () => setTheme('light')
    },
    {
      id: 'set-dark-theme',
      label: '어두운 모드 사용',
      group: '테마',
      onSelect: () => setTheme('dark')
    }
  ];
}
