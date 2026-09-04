import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { render } from '@testing-library/react';

import Loading from './loading';

describe('공고 route 로딩 경계', () => {
  test('직접 Skeleton markup 없이 화면 전용 skeleton 하나에 위임한다', () => {
    const source = readFileSync(new URL('./loading.tsx', import.meta.url), 'utf8');
    const screen = render(<Loading />);

    expect(source).not.toContain('<Skeleton');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  test('결정 화면과 같은 DecisionFrame geometry를 쓴다', () => {
    const screen = render(<Loading />);

    expect(screen.container.querySelector('[data-slot="decision-screen"]')).toBeTruthy();
  });
});
