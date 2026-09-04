import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import { DecisionScreen } from './decision-screen';

const search = { period: '12개월', scope: '전국', item: null } as const;

describe('결정 화면', () => {
  test('서버 markup에 프레임·제목·배너·수집 전 카드 셋이 있다', () => {
    const markup = renderToStaticMarkup(<DecisionScreen decision={presentDecision(openAuctionFixture, fixtureNow)} search={search} />);
    expect(markup).toContain('data-slot="decision-screen"');
    expect(markup).toContain('aria-labelledby="decision-title"');
    expect(markup).toContain('이 공고가 열려 있습니다');
    expect((markup.match(/수집 전/g) ?? []).length).toBe(3);
    expect(markup).toContain(openAuctionFixture.provenance.contentSha256);
  });
  test('금지 문구가 없다', () => {
    const markup = renderToStaticMarkup(<DecisionScreen decision={presentDecision(openAuctionFixture, fixtureNow)} search={search} />);
    for (const banned of ['NeaT', '탈락선', '밀림', '추천', '안전 구간']) expect(markup).not.toContain(banned);
  });
  test('section 순서가 상태·근거·과거 회차·투찰이다', () => {
    const screen = render(<DecisionScreen decision={presentDecision(openAuctionFixture, fixtureNow)} search={search} />);
    const labels = [...screen.container.querySelectorAll('section, aside')].map((node) => node.getAttribute('aria-label'));
    expect(labels).toEqual(['공고 상태', '근거', '과거 회차', '투찰']);
  });
});
