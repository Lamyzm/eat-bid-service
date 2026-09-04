/** @module 책임: 사용자가 적어둔 투찰값의 저장 port를 정의한다. 원본 관측값과 절대 합치지 않는 app 소유 상태이며 이 슬라이스는 메모리 adapter만 둔다. */
export type BidRecord = {
  readonly auctionId: string;
  readonly rate: string;
  readonly amount: string;
  // 기록 시각은 서버가 저장할 때 붙는다. 브라우저는 시계 권위가 아니다(규칙 15·17). 이 슬라이스에는
  // 영속화 adapter가 없어 항상 null을 저장하고, 서버 영속화가 붙는 후속 슬라이스에서 값이 채워진다.
  readonly recordedAt: string | null;
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
