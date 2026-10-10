import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CopyValue } from './copy-value';

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function stubClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(navigator, 'clipboard', original);
});

describe('값 복사 손잡이', () => {
  test('누르면 보이는 글자가 아니라 넘겨받은 값을 복사하고 복사됐다고 알린다', async () => {
    const written: string[] = [];
    stubClipboard(async (value) => { written.push(value); });
    const screen = render(<CopyValue value='7761885' label='1번 금액'>7,761,885원</CopyValue>);
    await userEvent.click(screen.getByRole('button', { name: /1번 금액 복사/ }));
    expect(written).toEqual(['7761885']);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('복사됨'));
  });

  test('클립보드가 막히면 조용히 실패하고 복사됐다고 말하지 않는다', async () => {
    stubClipboard(async () => { throw new Error('denied'); });
    const screen = render(<CopyValue value='7761885' label='1번 금액'>7,761,885원</CopyValue>);
    await userEvent.click(screen.getByRole('button', { name: /1번 금액 복사/ }));
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
