import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HISTORY_WINDOW_LIMIT, historyWindow, historyWindowText } from './history-window';

// route segment 이름의 대괄호가 URL로 인코딩되므로 경로는 fileURLToPath로 되돌려 읽는다.
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

describe('과거 회차 창', () => {
  test('회차가 상한보다 많으면 상한까지만 표시한다', () => {
    expect(historyWindowText(historyWindow(92, 60))).toBe(`92회 · 최근 ${HISTORY_WINDOW_LIMIT}회 표시`);
  });

  test('회차 1건이면 최근 1회 표시라고 적는다', () => {
    expect(historyWindowText(historyWindow(1, 1))).toBe('1회 · 최근 1회 표시');
  });

  test('회차 0건이면 0회 표시 대신 최근 표시 없음이라고 말한다', () => {
    expect(historyWindowText(historyWindow(0, 0))).toBe('0회 · 최근 표시 없음');
  });

  test('표본만 있고 그릴 행이 없으면 표본 수는 남기고 표시 없음이라고 말한다', () => {
    expect(historyWindowText(historyWindow(3, 0))).toBe('3회 · 최근 표시 없음');
  });

  test('셀 수 없는 값이 들어와도 NaN을 문구에 넣지 않는다', () => {
    expect(historyWindowText(historyWindow(Number.NaN, Number.NaN))).not.toContain('NaN');
    expect(historyWindowText(historyWindow(1, Number.NaN))).toBe('1회 · 최근 표시 없음');
  });

  // 부제는 서버 컴포넌트가 그린다. 이 모듈이 'use client'가 되면 서버 쪽 import가 client reference로
  // 바뀌어 상수가 숫자가 아니게 되고 부제가 다시 NaN이 된다(EAT-77의 실제 원인).
  test('상한을 소유한 모듈은 client 전용이 아니다', () => {
    const source = readFileSync(path.join(moduleDirectory, 'history-window.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*['"]use client['"]/m);
  });
});
