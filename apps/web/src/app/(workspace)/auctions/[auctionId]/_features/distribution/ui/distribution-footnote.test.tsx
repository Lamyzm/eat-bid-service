import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { emptyDistributionFixture, floor90DistributionFixture } from '../../../__fixtures__/distribution';
import { DistributionFootnote } from './distribution-footnote';

describe('분포 각주', () => {
  test('모집단·품목·하한율·기간·표본·수집분·계산 버전을 한 줄로 적는다', () => {
    const screen = render(<DistributionFootnote meta={floor90DistributionFixture.meta} scope='전국' />);
    const text = screen.container.textContent ?? '';
    expect(text).toContain('전국');
    // 분포 mart에 품목 축이 없다는 사실을 화면이 말하는 자리다(설계 §3.2).
    expect(text).toContain('품목 전체');
    expect(text).toContain('하한율 90.000');
    expect(text).toContain('2026-08 ~ 2026-09');
    expect(text).toContain('표본 82회차');
    expect(text).toContain('09-06 수집분');
    expect(text).toContain('계산 mart-r1');
  });

  test('계보가 null이면 그 조각을 지어내지 않고 뺀다', () => {
    const screen = render(<DistributionFootnote meta={emptyDistributionFixture.meta} scope='전국' />);
    const text = screen.container.textContent ?? '';
    expect(text).not.toContain('수집분');
    expect(text).not.toContain('계산');
    // 표본 수와 기간은 계보가 없어도 응답이 말할 수 있는 사실이다.
    expect(text).toContain('표본 0회차');
    expect(text).toContain('2026-08 ~ 2026-09');
  });

  test('표본이 적으면 각주가 그 라벨을 함께 말한다', () => {
    const thin = { ...floor90DistributionFixture.meta, sampleCount: 12 };
    const screen = render(<DistributionFootnote meta={thin} scope='시군' />);
    expect(screen.container.textContent).toContain('표본 12회차 · 표본 적음');
  });
});
