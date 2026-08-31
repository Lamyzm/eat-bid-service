import { describe, expect, test } from 'bun:test';

import { createApiRewrites } from './api-rewrites';

describe('Next API 진입점 재작성', () => {
  test('development에서만 검증한 Nest origin으로 /api 경로를 proxy한다', () => {
    expect(createApiRewrites({ nodeEnv: 'development', apiUrl: 'http://localhost:4400' })).toEqual([
      {
        source: '/api/:path*',
        destination: 'http://localhost:4400/api/:path*'
      }
    ]);
    expect(createApiRewrites({ nodeEnv: 'production', apiUrl: 'https://api.example.com' })).toEqual(
      []
    );
    expect(createApiRewrites({ nodeEnv: 'test', apiUrl: undefined })).toEqual([]);
  });

  test('development의 잘못된 origin과 path가 섞인 URL을 거부한다', () => {
    for (const apiUrl of [
      undefined,
      'ftp://localhost:4400',
      'http://user:password@localhost:4400',
      'http://localhost:4400/base',
      'not-a-url'
    ]) {
      expect(() => createApiRewrites({ nodeEnv: 'development', apiUrl }), String(apiUrl)).toThrow();
    }
  });
});
