/** @module 책임: 결정 화면의 여러 영역이 같은 투찰률 하나(또는 아직 없음)를 보도록 그 브라우저 상태를 한 곳에서 소유하고, 사용자가 놓은 값을 URL `rate`로 세션 동안 유지한다. */
'use client';

import { useSearchParams } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { type BidRate, parseBidRate } from '../_model/bid-rate';

type BidRateStore = {
  /** 사용자가 아직 값을 놓지 않았으면 null이다. 화면은 이 상태를 어떤 값으로도 메우지 않는다. */
  readonly rate: BidRate | null;
  readonly setRate: (next: BidRate | null) => void;
};

// 기본값을 둔 context 대신 null을 둬서 Provider 밖 사용을 조용한 오작동이 아니라 즉시 오류로 만든다.
// 투찰률이 영역마다 다르게 보이면 사용자가 잘못된 값을 NeaT에 옮겨 적는 사고가 된다.
const BidRateContext = createContext<BidRateStore | null>(null);

const RATE_PARAM = 'rate';

/**
 * 손잡이 값은 세션 동안 주소에 남는다(EAT-84). 서버 왕복 없이 `replaceState`로만 고치는 이유는 ±0.001 한
 * 번마다 RSC를 다시 그리면 회차 이력·분포 조회가 손잡이 속도를 따라오지 못하기 때문이다. 탭 링크는
 * 서버가 그린 주소라 손잡이가 바뀐 뒤의 값을 모르므로, 탭 이동으로 주소에서 빠진 값도 여기서 되살린다.
 */
function syncRateParam(rate: BidRate | null, routerValue: string | null) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(RATE_PARAM) === rate && routerValue === rate) return;
  if (rate === null) url.searchParams.delete(RATE_PARAM);
  else url.searchParams.set(RATE_PARAM, rate);
  window.history.replaceState(null, '', url);
}

export function BidRateProvider({
  initialRate = null,
  children
}: {
  /** URL `rate` 원문. 형식이 틀리면 빈 상태로 시작한다 — 주소를 손으로 고친 값을 추측으로 고쳐 쓰지 않는다. */
  readonly initialRate?: string | null;
  readonly children: React.ReactNode;
}) {
  // 화면이 먼저 놓는 손잡이 값은 곧 추천값이다(AGENTS 8, PDR-0004). 사용자가 놓기 전에는 비어 있다.
  const [rate, setRate] = useState<BidRate | null>(() => (initialRate === null ? null : parseBidRate(initialRate)));
  const searchParams = useSearchParams();
  useEffect(() => {
    // 라우터가 아는 주소는 탭 이동 뒤 값을 잃은 쪽이다. 그 값을 손잡이에 되읽지 않고 손잡이 값으로 주소를 고친다 —
    // 반대로 하면 주소와 손잡이라는 두 진실이 생긴다.
    syncRateParam(rate, searchParams?.get(RATE_PARAM) ?? null);
  }, [rate, searchParams]);
  const store = useMemo<BidRateStore>(() => ({ rate, setRate }), [rate]);
  return <BidRateContext.Provider value={store}>{children}</BidRateContext.Provider>;
}

export function useBidRate(): BidRateStore {
  const store = useContext(BidRateContext);
  if (!store) throw new Error('useBidRate는 BidRateProvider 안에서만 쓸 수 있습니다');
  return store;
}
