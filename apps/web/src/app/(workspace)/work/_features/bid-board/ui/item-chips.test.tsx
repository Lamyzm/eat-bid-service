import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';

import { ItemChips } from './item-chips';

afterEach(cleanup);

function renderChips(searchParams: string) {
  const updates: UrlUpdateEvent[] = [];
  const screen = render(
    <NuqsTestingAdapter hasMemory searchParams={searchParams} onUrlUpdate={(event) => updates.push(event)}>
      <ItemChips />
    </NuqsTestingAdapter>
  );
  return { screen, updates };
}

describe('오늘 투찰 품목 단추', () => {
  test('아무 품목도 고르지 않았으면 전부 단추가 눌린 상태라 지금 조건이 눈에 보인다', () => {
    const { screen } = renderChips('');
    expect(screen.getByRole('button', { name: '전부' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '육류' }).getAttribute('aria-pressed')).toBe('false');
  });

  test('품목을 고른 상태에서 전부를 누르면 품목 조건을 주소에서 지운다', async () => {
    const { screen, updates } = renderChips('?items=육류,가금류');
    expect(screen.getByRole('button', { name: '전부' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '육류' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: '전부' }));
    expect(updates.at(-1)!.searchParams.has('items')).toBe(false);
  });
});
