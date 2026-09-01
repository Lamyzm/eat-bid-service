/** @module 책임: 색상 theme cookie와 DOM attribute를 동기화하는 client context를 제공한다. */
'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import {
  ACTIVE_THEME_COOKIE_NAME,
  DEFAULT_THEME,
  isThemeValue,
  type ThemeValue
} from './theme.config';

function setThemeCookie(theme: ThemeValue): void {
  if (typeof window === 'undefined') return;
  document.cookie = `${ACTIVE_THEME_COOKIE_NAME}=${theme}; path=/; max-age=31536000; SameSite=Lax; ${window.location.protocol === 'https:' ? 'Secure;' : ''}`;
}

interface ThemeContextValue {
  readonly activeTheme: ThemeValue;
  readonly setActiveTheme: (theme: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ActiveThemeProvider({
  children,
  initialTheme = DEFAULT_THEME
}: {
  readonly children: ReactNode;
  readonly initialTheme?: ThemeValue;
}) {
  const [activeTheme, setActiveThemeState] = useState<ThemeValue>(initialTheme);
  const setActiveTheme = useCallback((theme: string) => {
    if (isThemeValue(theme)) setActiveThemeState(theme);
  }, []);

  useEffect(() => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    if (currentTheme !== activeTheme) {
      setThemeCookie(activeTheme);
      document.documentElement.removeAttribute('data-theme');
      for (const className of Array.from(document.body.classList)) {
        if (className.startsWith('theme-')) document.body.classList.remove(className);
      }
      document.documentElement.setAttribute('data-theme', activeTheme);
    } else {
      // HTML 속성과 이미 같아도 만료되거나 누락된 cookie는 다시 기록한다.
      setThemeCookie(activeTheme);
    }
  }, [activeTheme]);

  return (
    <ThemeContext.Provider value={{ activeTheme, setActiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeConfig(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useThemeConfig는 ActiveThemeProvider 안에서 사용해야 합니다.');
  return context;
}
