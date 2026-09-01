/** @module 책임: navigation·theme·등록 action을 키보드 검색 가능한 명령 UI로 조합한다. */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useTheme } from 'next-themes';
import { useThemeConfig } from '@/shell/theme/active-theme';
import { THEMES } from '@/shell/theme/theme.config';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command';
import type { NavGroup, NavItem } from '@/types';
import { navGroups } from '@/config/nav-config';
import { useFilteredNavGroups } from '@/hooks/use-nav';
import {
  CommandPaletteContext,
  type CommandPaletteAction,
  type CommandPaletteController
} from './context';
import { createThemeActions } from './theme-actions';

export type { CommandPaletteAction } from './context';

function navigationItemActions(
  item: NavItem,
  group: string,
  navigate: (url: Route) => void
): CommandPaletteAction[] {
  const ownAction =
    item.url === '#'
      ? []
      : [
          {
            id: `navigation:${item.url}`,
            label: item.title,
            description: `${item.title} 화면으로 이동합니다`,
            group,
            keywords: [group, item.title],
            shortcut: item.shortcut,
            onSelect: () => navigate(item.url)
          }
        ];
  const childActions =
    item.items?.flatMap((child) => navigationItemActions(child, item.title, navigate)) ?? [];
  return [...ownAction, ...childActions];
}

export function createNavigationActions(
  groups: NavGroup[],
  navigate: (url: Route) => void
): CommandPaletteAction[] {
  return groups.flatMap((group) =>
    group.items.flatMap((item) => navigationItemActions(item, group.label, navigate))
  );
}

function groupActions(actions: CommandPaletteAction[]) {
  const groups = new Map<string, CommandPaletteAction[]>();
  for (const action of actions) {
    const entries = groups.get(action.group) ?? [];
    entries.push(action);
    groups.set(action.group, entries);
  }
  return groups;
}

export function CommandPaletteRoot({
  actions,
  children
}: {
  actions: CommandPaletteAction[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openPalette = useCallback(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    const returnTarget = returnFocusRef.current;
    queueMicrotask(() => returnTarget?.focus());
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) openPalette();
      else closePalette();
    },
    [closePalette, openPalette]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      if (open) closePalette();
      else openPalette();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closePalette, open, openPalette]);

  const controller = useMemo<CommandPaletteController>(() => ({ openPalette }), [openPalette]);
  const groupedActions = useMemo(() => groupActions(actions), [actions]);

  return (
    <CommandPaletteContext.Provider value={controller}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title='명령 검색'
        description='화면 이동과 테마 명령을 검색합니다.'
      >
        <Command label='명령 검색어'>
          <CommandInput aria-label='명령 검색어' placeholder='명령을 검색하세요...' autoFocus />
          <CommandList>
            <CommandEmpty>일치하는 명령이 없습니다.</CommandEmpty>
            {[...groupedActions].map(([group, groupEntries]) => (
              <CommandGroup key={group} heading={group}>
                {groupEntries.map((action) => (
                  <CommandItem
                    key={action.id}
                    value={action.label}
                    keywords={action.keywords}
                    onSelect={() => {
                      action.onSelect();
                      closePalette();
                    }}
                  >
                    <span className='flex min-w-0 flex-col'>
                      <span>{action.label}</span>
                      {action.description ? (
                        <span className='truncate text-xs text-muted-foreground'>
                          {action.description}
                        </span>
                      ) : null}
                    </span>
                    {action.shortcut?.length ? (
                      <CommandShortcut>{action.shortcut.join(' ')}</CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}

export default function CommandPalette({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const filteredGroups = useFilteredNavGroups(navGroups);
  const { theme, setTheme } = useTheme();
  const { activeTheme, setActiveTheme } = useThemeConfig();
  const actions = useMemo(
    () => [
      ...createNavigationActions(filteredGroups, (url) => router.push(url)),
      ...createThemeActions({ theme, activeTheme, themes: THEMES, setTheme, setActiveTheme })
    ],
    [activeTheme, filteredGroups, router, setActiveTheme, setTheme, theme]
  );

  return <CommandPaletteRoot actions={actions}>{children}</CommandPaletteRoot>;
}
