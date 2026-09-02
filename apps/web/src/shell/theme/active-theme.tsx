/** @module 책임: 색상 theme의 권위를 <html data-theme> DOM 속성에 두고 cookie와 동기화하는 client context를 제공한다. */
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode
} from 'react';

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

// server는 기본 theme으로 static 렌더하고 root layout의 inline script가 cookie 값을 첫 paint 전에 DOM에
// 적용한다(ADR 0028). 그래서 React state가 아니라 DOM 속성이 권위이며, hydration 중에는 server snapshot을
// 쓰고 직후 DOM 값으로 다시 렌더해 mismatch 없이 cookie theme을 채택한다.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readDomTheme(): ThemeValue {
  const current = document.documentElement.getAttribute('data-theme');
  return isThemeValue(current) ? current : DEFAULT_THEME;
}

function applyDomTheme(theme: ThemeValue): void {
  document.documentElement.setAttribute('data-theme', theme);
  setThemeCookie(theme);
  for (const listener of listeners) listener();
}

interface ThemeContextValue {
  readonly activeTheme: ThemeValue;
  readonly setActiveTheme: (theme: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ActiveThemeProvider({ children }: { readonly children: ReactNode }) {
  // server는 DOM을 읽을 수 없으므로 기본 theme snapshot으로 렌더하고, hydration 직후 client snapshot이
  // inline script가 적용한 실제 값을 가져온다.
  const activeTheme = useSyncExternalStore<ThemeValue>(subscribe, readDomTheme, () => DEFAULT_THEME);
  const setActiveTheme = useCallback((theme: string) => {
    if (isThemeValue(theme)) applyDomTheme(theme);
  }, []);

  useEffect(() => {
    // 허용 목록 밖 속성은 기본 theme으로 되돌리고, 속성과 같아도 만료되거나 누락된 cookie는 다시 기록한다.
    const current = document.documentElement.getAttribute('data-theme');
    if (isThemeValue(current)) setThemeCookie(current);
    else applyDomTheme(DEFAULT_THEME);
  }, []);

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
