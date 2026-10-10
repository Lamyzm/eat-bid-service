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

  test('표시를 켜면 값 옆에 복사가 보이고 누르면 그 자리가 복사됨으로 바뀐다', async () => {
    // 금액 자체가 단추라는 것은 눈으로 알 수 없다. 손으로 옮겨 치다 생기는 오타를 막으려면 복사할 수 있다는 표시가 늘 보여야 한다.
    stubClipboard(async () => {});
    const screen = render(<CopyValue value='7761885' label='1번 금액' chip>7,761,885원</CopyValue>);
    const chip = screen.container.querySelector('[data-slot="copy-chip"]');
    expect(chip?.textContent).toBe('복사');
    await userEvent.click(screen.getByRole('button', { name: /1번 금액 복사/ }));
    await waitFor(() => expect(chip?.textContent).toBe('복사됨'));
    expect(screen.getByRole('status').textContent).toBe('복사됨');
  });

  test('클립보드가 막히면 조용히 실패하고 복사됐다고 말하지 않는다', async () => {
    stubClipboard(async () => { throw new Error('denied'); });
    const screen = render(<CopyValue value='7761885' label='1번 금액'>7,761,885원</CopyValue>);
    await userEvent.click(screen.getByRole('button', { name: /1번 금액 복사/ }));
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
