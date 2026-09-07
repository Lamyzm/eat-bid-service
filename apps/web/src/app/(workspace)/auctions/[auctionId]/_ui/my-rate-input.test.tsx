import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { DecisionSearch } from '../_lib/decision-search-params';
import { MyRateInput } from './my-rate-input';

// happy-dom에서 fireEvent.change는 React onChange를 트리거하지 않는다(네이티브 값 추적기가 우회됨).
// `bid-rail.test.tsx`와 같은 이유로 userEvent.type을 쓰고 시나리오마다 새로 렌더한다.

const search: DecisionSearch = {
  period: '12개월',
  scope: '전국',
  view: '비교집단',
  item: null,
  myRate: null,
  rate: null,
  expand: null,
  pages: 1
};

describe('내 값 입력', () => {
  test('기본값 없이 비어 있고 축을 안내문으로 명시한다', () => {
    const screen = render(<MyRateInput auctionId='4821' search={search} />);
    const input = screen.getByLabelText('내 값(사정률)') as HTMLInputElement;
    // 최빈 칸이나 하한율을 기본값으로 두면 그것이 추천값이 된다(AGENTS 8, PDR-0004).
    expect(input.value).toBe('');
    expect(screen.getByText('이 눈금은 사정률입니다. NeaT에 넣는 투찰률과 분모가 다릅니다.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '사다리에 놓기' })).toBeNull();
  });

  test('유효한 사정률을 넣으면 그 값을 담은 주소로 가는 링크가 생긴다', async () => {
    const user = userEvent.setup();
    const screen = render(<MyRateInput auctionId='4821' search={search} />);
    await user.type(screen.getByLabelText('내 값(사정률)'), '90.03');
    const link = screen.getByRole('link', { name: '사다리에 놓기' });
    expect(link.getAttribute('href')).toContain('myRate=90.03');
  });

  test('잘못된 입력은 링크를 만들지 않아 URL을 오염시키지 않는다', async () => {
    const user = userEvent.setup();
    const screen = render(<MyRateInput auctionId='4821' search={search} />);
    await user.type(screen.getByLabelText('내 값(사정률)'), '90.0301');
    expect(screen.queryByRole('link', { name: '사다리에 놓기' })).toBeNull();
    expect(screen.getByLabelText('내 값(사정률)').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('사정률은 소수 셋째 자리까지입니다')).toBeTruthy();
  });

  test('이미 놓은 값은 내 값을 뺀 주소로 지울 수 있다', () => {
    const screen = render(<MyRateInput auctionId='4821' search={{ ...search, myRate: '90.030' }} />);
    expect(screen.getByRole('link', { name: '지우기' }).getAttribute('href')).not.toContain('myRate');
  });

  test('놓은 값이 없으면 지우기 링크를 그리지 않는다', () => {
    const screen = render(<MyRateInput auctionId='4821' search={search} />);
    expect(screen.queryByRole('link', { name: '지우기' })).toBeNull();
  });
});
