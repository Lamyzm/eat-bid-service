import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { META_THEME_COLORS } from './meta-theme-color';

const themeSource = readFileSync(
  new URL('../../styles/themes/eatbid.css', import.meta.url),
  'utf8'
);

function surfaceIn(block: string): string | undefined {
  return block.match(/--eb-surface:\s*(#[0-9a-f]{6})/i)?.[1]?.toLowerCase();
}

describe('주소창 색(meta theme-color)', () => {
  test('밝게·어둡게 모두 토큰 파일의 지면 색과 같다', () => {
    const [light, dark] = themeSource.split(/^\.dark\s*\{/m);
    expect(surfaceIn(light ?? '')).toBe(META_THEME_COLORS.light);
    expect(surfaceIn(dark ?? '')).toBe(META_THEME_COLORS.dark);
  });
});
