import { describe, expect, test } from 'bun:test';

import { createMemoryBidRecordPort } from './bid-record-port';

describe('내 값 기록 port', () => {
  test('저장한 기록을 같은 공고에서 다시 읽고 다른 공고에서는 없다', async () => {
    const port = createMemoryBidRecordPort();
    await port.save({ auctionId: '5796468', rate: '90.309', amount: '2494063', recordedAt: '2026-09-03T01:32:00Z' });
    expect((await port.load('5796468'))?.rate).toBe('90.309');
    expect(await port.load('1')).toBeNull();
  });
});
