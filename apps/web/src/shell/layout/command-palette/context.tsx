/** @module 책임: 명령 palette의 열림 상태와 feature가 등록하는 action 수명주기를 제공한다. */
'use client';

import { createContext, useContext } from 'react';

export interface CommandPaletteAction {
  id: string;
  label: string;
  description?: string;
  group: string;
  keywords?: string[];
  shortcut?: string[];
  onSelect: () => void;
}

export interface CommandPaletteController {
  openPalette: () => void;
}

export const CommandPaletteContext = createContext<CommandPaletteController | null>(null);

export function useCommandPalette() {
  const controller = useContext(CommandPaletteContext);
  if (!controller) {
    throw new Error('CommandPaletteRoot 안에서 useCommandPalette를 사용해야 합니다.');
  }
  return controller;
}
