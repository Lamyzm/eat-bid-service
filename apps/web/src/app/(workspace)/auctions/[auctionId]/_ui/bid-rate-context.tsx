/** @module 책임: 결정 화면의 여러 영역이 같은 투찰률 하나를 보도록 그 브라우저 상태를 한 곳에서 소유한다. */
'use client';

import { createContext, useContext, useMemo, useState } from 'react';

import type { BidRate } from '../_model/bid-rate';

type BidRateStore = {
  readonly rate: BidRate;
  readonly setRate: (next: BidRate) => void;
};

// 기본값을 둔 context 대신 null을 둬서 Provider 밖 사용을 조용한 오작동이 아니라 즉시 오류로 만든다.
// 투찰률이 영역마다 다르게 보이면 사용자가 잘못된 값을 NeaT에 옮겨 적는 사고가 된다.
const BidRateContext = createContext<BidRateStore | null>(null);

export function BidRateProvider({
  initialRate = '90.000',
  children
}: {
  readonly initialRate?: BidRate;
  readonly children: React.ReactNode;
}) {
  const [rate, setRate] = useState<BidRate>(initialRate);
  const store = useMemo<BidRateStore>(() => ({ rate, setRate }), [rate]);
  return <BidRateContext.Provider value={store}>{children}</BidRateContext.Provider>;
}

export function useBidRate(): BidRateStore {
  const store = useContext(BidRateContext);
  if (!store) throw new Error('useBidRate는 BidRateProvider 안에서만 쓸 수 있습니다');
  return store;
}
