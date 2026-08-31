import { describe, expect, test } from 'bun:test';

import { formatBytes as legacyFormatBytes } from '@/lib/utils';
import { formatBytes } from './format-bytes';

describe('파일 크기 표시 호환 경계', () => {
  test('신규 shared 경로와 기존 lib 경로가 같은 값을 반환한다', () => {
    for (const [bytes, expected] of [
      [0, '0 Byte'],
      [1024, '1 KB'],
      [1536, '2 KB']
    ] as const) {
      expect(formatBytes(bytes)).toBe(expected);
      expect(legacyFormatBytes(bytes)).toBe(expected);
    }
    expect(formatBytes(1024, { sizeType: 'accurate' })).toBe('1 KiB');
    expect(legacyFormatBytes(1024, { sizeType: 'accurate' })).toBe('1 KiB');
  });
});
