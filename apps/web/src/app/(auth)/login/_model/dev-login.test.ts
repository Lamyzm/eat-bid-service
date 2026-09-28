import { describe, expect, test } from 'bun:test';

import { isDevAutoLoginEnabled, isDevLoginEnabled } from './dev-login';

describe('개발 로그인 폼 판정', () => {
  test('production이 아니면서 EATBID_DEV_LOGIN이 정확히 "true"일 때만 폼을 연다', () => {
    expect(isDevLoginEnabled({ nodeEnv: 'development', devLogin: 'true' })).toBe(true);
    expect(isDevLoginEnabled({ nodeEnv: 'test', devLogin: 'true' })).toBe(true);
    expect(isDevLoginEnabled({ nodeEnv: undefined, devLogin: 'true' })).toBe(true);
  });

  test('production에서는 플래그가 있어도 열지 않고, 플래그가 없거나 다른 값이면 어디서도 열지 않는다', () => {
    expect(isDevLoginEnabled({ nodeEnv: 'production', devLogin: 'true' })).toBe(false);
    expect(isDevLoginEnabled({ nodeEnv: 'development', devLogin: undefined })).toBe(false);
    expect(isDevLoginEnabled({ nodeEnv: 'development', devLogin: 'false' })).toBe(false);
    expect(isDevLoginEnabled({ nodeEnv: 'development', devLogin: '1' })).toBe(false);
    expect(isDevLoginEnabled({ nodeEnv: 'development', devLogin: 'TRUE' })).toBe(false);
  });
});

describe('로컬 dev 자동 로그인 판정', () => {
  test('개발 로그인이 열려 있고 EATBID_DEV_AUTO_LOGIN이 정확히 "true"일 때만 자동 제출한다', () => {
    expect(isDevAutoLoginEnabled({ nodeEnv: 'development', devLogin: 'true', devAutoLogin: 'true' })).toBe(true);
    expect(isDevAutoLoginEnabled({ nodeEnv: 'development', devLogin: 'true', devAutoLogin: undefined })).toBe(false);
    expect(isDevAutoLoginEnabled({ nodeEnv: 'development', devLogin: 'true', devAutoLogin: '1' })).toBe(false);
  });

  test('production이거나 개발 로그인이 닫혀 있으면 자동 로그인 값이 있어도 제출하지 않는다', () => {
    expect(isDevAutoLoginEnabled({ nodeEnv: 'production', devLogin: 'true', devAutoLogin: 'true' })).toBe(false);
    expect(isDevAutoLoginEnabled({ nodeEnv: 'development', devLogin: undefined, devAutoLogin: 'true' })).toBe(false);
  });
});
