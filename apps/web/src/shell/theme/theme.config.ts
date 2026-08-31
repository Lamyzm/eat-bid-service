export const ACTIVE_THEME_COOKIE_NAME = 'active_theme';
export const DEFAULT_THEME = 'eatbid';

// 서버 cookie 검증과 클라이언트 선택기가 함께 쓰는 색상 테마 SSOT다.
export const THEMES = [
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
