'use client';

import type { ReactNode } from 'react';

import { ActiveThemeProvider } from '../theme/active-theme';
import type { ThemeValue } from '../theme/theme.config';
import { QueryProvider } from './query-provider';

export function AppProviders({
  activeThemeValue,
  children
}: {
  readonly activeThemeValue: ThemeValue;
  readonly children: ReactNode;
}) {
  return (
    <ActiveThemeProvider initialTheme={activeThemeValue}>
      <QueryProvider>{children}</QueryProvider>
    </ActiveThemeProvider>
  );
}
