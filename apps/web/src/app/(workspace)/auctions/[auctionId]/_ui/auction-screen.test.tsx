import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

import { auctionFixture } from '../__fixtures__/auction';
import { presentAuction } from '../_model/present-auction';
import { AuctionScreen } from './auction-screen';

describe('공고 상세 화면', () => {
  test('유효한 계약 fixture를 Client API 없이 서버 markup으로 렌더한다', () => {
    const markup = renderToStaticMarkup(<AuctionScreen auction={presentAuction(auctionFixture)} />);

    expect(markup).toContain('data-slot="auction-screen"');
    expect(markup).toContain('aria-labelledby="auction-title"');
    expect(markup).toContain(auctionFixture.identity.auctionId);
    expect(markup).toContain(auctionFixture.provenance.contentSha256);
  });

  test('계약 fixture를 식별·가격·출처 영역이 분리된 안정된 markup으로 렌더한다', () => {
    const screen = render(<AuctionScreen auction={presentAuction(auctionFixture)} />);
    const frame = screen.container.querySelector('[data-slot="auction-screen"]');

    expect(frame).not.toBeNull();
    if (!frame) throw new Error('공고 화면 frame이 필요합니다.');
    expect(frame.querySelectorAll(':scope > section')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: auctionFixture.identity.title })).toBeTruthy();
    expect(screen.getByText('9,007,199,254,740,993.50 KRW')).toBeTruthy();
    expect(screen.getAllByText('미확인')).toHaveLength(3);
    expect(screen.getByText(auctionFixture.identity.revisionId)).toBeTruthy();
    expect(screen.getByText(auctionFixture.provenance.sourceSystem)).toBeTruthy();
    expect(screen.getByText(auctionFixture.provenance.observationId)).toBeTruthy();
    expect(screen.getByText(auctionFixture.provenance.normalizedRecordId)).toBeTruthy();
    expect(screen.getByText(auctionFixture.provenance.contentSha256)).toBeTruthy();
  });
});
