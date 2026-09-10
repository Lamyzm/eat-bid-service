import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const headerSource = readFileSync(new URL('./header.tsx', import.meta.url), 'utf8');

describe('상단 헤더 테마 선택기', () => {
  test('색상 테마 선택기를 항상 제공한다', () => {
    expect(headerSource).toMatch(
      /import\s*{[^}]*ThemeModeToggle[^}]*ThemeSelector[^}]*}\s*from\s*['"]@\/shell['"]/
    );
    expect(headerSource).toMatch(/<ThemeSelector\s*\/>/);
  });
});

describe('상단 헤더 control slot', () => {
  test('endpoint를 읽는 legacy control은 header가 직접 import하지 않고 slot으로 받는다', () => {
    expect(headerSource).not.toMatch(/region-switcher|session-boot|global-settings/);
    expect(headerSource).toMatch(/controls\?: React\.ReactNode/);
    expect(headerSource).toMatch(/\{controls\}/);
  });
});
