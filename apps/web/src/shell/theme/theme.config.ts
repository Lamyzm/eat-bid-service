/** @module 책임: 서버 첫 화면과 클라이언트 선택기가 공유하는 허용 테마 목록과 기본값을 소유한다. */
export const ACTIVE_THEME_COOKIE_NAME = 'active_theme';

/**
 * 시안이 이 테마 위에서 그려졌으므로 기본값도 같아야 한다. 기본이 다르면 처음 들어온 사용자가
 * 시안과 다른 화면을 보고, 우리가 시안과 대조할 때마다 테마를 먼저 바꿔야 한다(2026-09-13 결정).
 */
export const DEFAULT_THEME = 'toss';

// 서버 cookie 검증과 클라이언트 선택기가 함께 쓰는 색상 테마 SSOT다.
export const THEMES = [
  { name: 'Toss 기반', value: 'toss' },
  { name: 'Eatbid', value: 'eatbid' },
  { name: 'Claude', value: 'claude' },
  { name: 'Discord', value: 'discord' },
  { name: 'Supabase', value: 'supabase' },
  { name: 'Vercel', value: 'vercel' },
  { name: 'Mono', value: 'mono' },
  { name: 'Notebook', value: 'notebook' },
  { name: '연두', value: 'light-green' },
  { name: 'Zen', value: 'zen' },
  { name: 'Astro Vista', value: 'astro-vista' },
  { name: 'WhatsApp', value: 'whatsapp' }
] as const;

export type ThemeValue = (typeof THEMES)[number]['value'];

export function isThemeValue(value: unknown): value is ThemeValue {
  return typeof value === 'string' && THEMES.some((theme) => theme.value === value);
}
