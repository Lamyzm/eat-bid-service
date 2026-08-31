import type { CommandPaletteAction } from './context';

interface ThemeOption {
  name: string;
  value: string;
}

interface CreateThemeActionsInput {
  theme: string | undefined;
  activeTheme: string;
  themes: readonly ThemeOption[];
  setTheme: (theme: string) => void;
  setActiveTheme: (theme: string) => void;
}

export function createThemeActions({
  theme,
  activeTheme,
  themes,
  setTheme,
  setActiveTheme
}: CreateThemeActionsInput): CommandPaletteAction[] {
  const currentIndex = themes.findIndex((candidate) => candidate.value === activeTheme);
  const nextTheme = themes[(currentIndex + 1 + themes.length) % themes.length];

  return [
    {
      id: 'cycle-theme',
      label: '색상 테마 전환',
      description: '다음 색상 테마를 적용합니다',
      group: '테마',
      shortcut: ['t', 't'],
      onSelect: () => {
        if (nextTheme) setActiveTheme(nextTheme.value);
      }
    },
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
