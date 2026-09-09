/** @module 책임: 흐름 차트와 컨트롤이 같은 내 투찰 상태·사업자 선택·표시 모델을 읽도록 context 하나와 provider 밖에서도 안전한 접근을 소유한다. */
'use client';

import { createContext, useContext } from 'react';

import type { MyAttemptBidObservation } from '@eatbid/contracts/api/v1/me';
import type { RegisteredBusiness } from '@/api/account';
import type { OwnAttemptSummary } from '../../_model/own-bid-points';

/**
 * 상태를 이름으로 나눈다. "점이 없다"는 미로그인·사업자 없음·미관측·명단 없음·조회 실패가 모두 만들 수 있는
 * 결과이고, 사용자가 다음에 할 일은 각각 다르다. 하나의 boolean으로 줄이면 화면이 미참여를 말하게 된다.
 */
export type OwnBidStatus =
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'auth-unavailable' }
  | { readonly kind: 'uninitialized' }
  | { readonly kind: 'no-businesses' }
  | { readonly kind: 'select-business' }
  | { readonly kind: 'history-not-ready' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'observed'; readonly summary: OwnAttemptSummary }
  | { readonly kind: 'unobserved' }
  | { readonly kind: 'evidence-conflict' }
  | { readonly kind: 'build-changed' }
  | { readonly kind: 'error'; readonly retry: () => void };

export type OwnBidValue = {
  readonly status: OwnBidStatus;
  readonly businesses: readonly RegisteredBusiness[];
  /** 등록이 하나면 그 사업자, 여럿이면 사용자가 고른 사업자다. 고르기 전에는 null이며 기본값을 두지 않는다. */
  readonly selectedBusinessId: string | null;
  readonly select: (businessId: string) => void;
  /**
   * 캔버스가 점을 만들 원본 관측이다. 점 좌표는 회차 행이 있어야 만들 수 있으므로 이미 행을 가진 차트가
   * 만들고, 여기서는 회차 결과만 넘긴다. `observed`가 아닌 상태에서는 이전 응답이 남지 않도록 null이다.
   */
  readonly observations: readonly MyAttemptBidObservation[] | null;
};

export const OwnBidContext = createContext<OwnBidValue | null>(null);

/** 독립 차트 미리보기와 검사에는 provider가 없다. 그때 캔버스는 own 계열 없이 그대로 동작한다. */
export function useOptionalOwnBid(): OwnBidValue | null {
  return useContext(OwnBidContext);
}
