import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const headerSource = readFileSync(new URL('./header.tsx', import.meta.url), 'utf8');

describe('상단 헤더 테마 선택기', () => {
  test('색상 테마 선택기를 항상 제공한다', () => {
    expect(headerSource).toMatch(
      /import\s*{\s*ThemeSelector\s*}\s*from\s*['"]\.\.\/themes\/theme-selector['"]/
    );
    expect(headerSource).toMatch(/<ThemeSelector\s*\/>/);
  });
});
