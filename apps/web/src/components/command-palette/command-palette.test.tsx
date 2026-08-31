import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchInput from '@/components/search-input';
import {
  CommandPaletteRoot,
  createNavigationActions,
  type CommandPaletteAction
} from './command-palette';

function actions(onSelect: (id: string) => void): CommandPaletteAction[] {
  return [
    {
      id: 'today',
      label: '오늘 공고',
      description: '오늘 확인할 공고를 엽니다',
      group: '공고',
      keywords: ['오늘', '공고'],
      shortcut: ['t', 't'],
      onSelect: () => onSelect('today')
    },
    {
      id: 'market',
      label: '시장 지도',
      group: '낙찰',
      keywords: ['시장', '지도'],
      onSelect: () => onSelect('market')
    }
  ];
}

describe('CommandPaletteRoot', () => {
  test('검색 trigger와 Cmd/Ctrl+K로 열고 닫을 수 있다', async () => {
    const screen = render(
      <CommandPaletteRoot actions={actions(() => undefined)}>
        <SearchInput />
      </CommandPaletteRoot>
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: '명령 검색' });

    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: '명령 검색' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '명령 검색' })).toBeNull();

    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: '명령 검색' })).toBeTruthy();
  });

  test('검색 결과를 키보드로 실행하고 trigger focus를 복원한다', async () => {
    const selected: string[] = [];
    const screen = render(
      <CommandPaletteRoot actions={actions((id) => selected.push(id))}>
        <SearchInput />
      </CommandPaletteRoot>
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: '명령 검색' });

    await user.click(trigger);
    await user.type(screen.getByRole('combobox', { name: '명령 검색어' }), '시장');
    await user.keyboard('{ArrowDown}{Enter}');
    await Promise.resolve();

    expect(selected).toEqual(['market']);
    expect(screen.queryByRole('dialog', { name: '명령 검색' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('빈 검색 결과를 한국어로 알린다', async () => {
    const screen = render(
      <CommandPaletteRoot actions={actions(() => undefined)}>
        <SearchInput />
      </CommandPaletteRoot>
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '명령 검색' }));
    await user.type(screen.getByRole('combobox', { name: '명령 검색어' }), '존재하지않는명령');

    expect(screen.getByText('일치하는 명령이 없습니다.')).toBeTruthy();
  });
});

test('navigation action은 선택한 내부 경로를 한 번 실행한다', () => {
  const visited: string[] = [];
  const navigation = createNavigationActions(
    [
      {
        label: '공고',
        items: [{ title: '오늘', url: '/dashboard/today', items: [] }]
      }
    ],
    (url) => visited.push(url)
  );

  navigation[0].onSelect();

  expect(visited).toEqual(['/dashboard/today']);
});
