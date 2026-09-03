/** @module 책임: 사용자가 적어둔 투찰값의 저장 port를 정의한다. 원본 관측값과 절대 합치지 않는 app 소유 상태이며 이 슬라이스는 메모리 adapter만 둔다. */
export type BidRecord = {
  readonly auctionId: string;
  readonly rate: string;
  readonly amount: string;
  readonly recordedAt: string;
};

export interface BidRecordPort {
  load(auctionId: string): Promise<BidRecord | null>;
  save(record: BidRecord): Promise<void>;
}

export function createMemoryBidRecordPort(): BidRecordPort {
  const records = new Map<string, BidRecord>();
  return {
    async load(auctionId) {
      return records.get(auctionId) ?? null;
    },
    async save(record) {
      records.set(record.auctionId, record);
    }
  };
}
