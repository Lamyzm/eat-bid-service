import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_RETURN_PATH,
  isAuctionReturn,
  isSameAppReturnPath,
  loginRouteWithReturn,
  returnRoute,
  safeReturnPath,
  setupRouteWithReturn
} from './return-path';

describe('로그인 복귀 경로 검증', () => {
  test('같은 앱의 절대 경로만 통과한다', () => {
    expect(isSameAppReturnPath('/today')).toBe(true);
    expect(isSameAppReturnPath('/today?region=1')).toBe(true);
    expect(isSameAppReturnPath('/auctions/9007199254740993#history')).toBe(true);
  });

  test('외부 origin과 authority로 읽히는 값을 거부한다', () => {
    for (const value of [
      'https://evil.example/today',
      '//evil.example/today',
      '/\\evil.example',
      'javascript:alert(1)',
      'today',
      ''
    ]) {
      expect(isSameAppReturnPath(value)).toBe(false);
    }
  });

  test('인코딩된 구분자와 제어문자를 거부한다', () => {
    for (const value of [
      '/%2f%2fevil.example',
      '/today%5c%5cevil.example',
      '/today%252fevil',
      '/to\nday',
      '/to\tday',
      '/today\\evil'
    ]) {
      expect(isSameAppReturnPath(value)).toBe(false);
    }
  });

  test('문자열이 아니거나 상한을 넘는 값을 거부한다', () => {
    expect(isSameAppReturnPath(undefined)).toBe(false);
    expect(isSameAppReturnPath(['/today'])).toBe(false);
    expect(isSameAppReturnPath(`/${'a'.repeat(512)}`)).toBe(false);
  });

  test('안전하지 않은 값은 오류가 아니라 기본 경로로 대체한다', () => {
    expect(safeReturnPath('//evil.example')).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath('/setup')).toBe('/setup');
  });

  test('redirect 대상은 실제 화면으로 좁히고 query는 보존한다', () => {
    expect(returnRoute('/setup')).toBe('/setup');
    expect(returnRoute('/today?region=1')).toBe('/today?region=1');
    // 공고 상세는 이 앱에서 가장 흔한 복귀 지점이라 식별자 모양을 검사해 그대로 돌려준다.
    expect(returnRoute('/auctions/9007199254740993')).toBe('/auctions/9007199254740993');
    expect(returnRoute('/auctions/5796468?view=흐름')).toBe('/auctions/5796468?view=흐름');
    // fragment는 판정 대상이 아니다. 앵커 하나 때문에 보던 공고를 잃지 않는다.
    expect(returnRoute('/auctions/5796468#history')).toBe('/auctions/5796468');
    expect(returnRoute('/today?region=1#상세')).toBe('/today?region=1');
    // 없는 화면, 식별자가 아닌 segment, 안전하지 않은 값은 모두 기본 진입으로 되돌린다.
    expect(returnRoute('/auctions/0123')).toBe(DEFAULT_RETURN_PATH);
    expect(returnRoute('/auctions/5796468/edit')).toBe(DEFAULT_RETURN_PATH);
    expect(returnRoute('/admin')).toBe(DEFAULT_RETURN_PATH);
    expect(returnRoute('https://evil.example')).toBe(DEFAULT_RETURN_PATH);
  });

  test('복귀 대상이 공고인지 구분해 링크 문구를 고를 수 있게 한다', () => {
    expect(isAuctionReturn('/auctions/5796468')).toBe(true);
    expect(isAuctionReturn('/auctions/5796468?view=흐름')).toBe(true);
    expect(isAuctionReturn('/auctions/5796468#history')).toBe(true);
    expect(isAuctionReturn('/today')).toBe(false);
    expect(isAuctionReturn('//evil.example/auctions/1')).toBe(false);
  });

  test('로그인 링크는 검증한 경로만 담는다', () => {
    expect(loginRouteWithReturn('/setup')).toBe('/login?next=%2Fsetup');
    expect(loginRouteWithReturn('//evil.example')).toBe('/login?next=%2Ftoday');
  });

  test('설정 링크는 보던 화면을 그대로 이어 나르고 없으면 만들지 않는다', () => {
    expect(setupRouteWithReturn('/auctions/5796468')).toBe('/setup?next=%2Fauctions%2F5796468');
    expect(setupRouteWithReturn(undefined)).toBe('/setup');
    // 안전하지 않은 값은 기본 경로로 바꾸지 않고 아예 담지 않는다.
    expect(setupRouteWithReturn('https://evil.example')).toBe('/setup');
  });
});
