/** @module 책임: 로그인 계정·등록 사업자·회차 이력 표본을 내 투찰 batch 조회 하나로 조립하고 사업자 선택을 현재 principal 안에 가두어 흐름 차트에 표시 모델을 넘긴다. */
'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import {
  accountQueries,
  isAccountDependencyUnavailableError,
  isBidObservationsBuildChangedError,
  type BidObservationAttemptKey,
  type MyBidObservationsV1Response,
  type MyBusinessesV1Response,
  type PrivateWorkspaceScope,
  type RegisteredBusiness
} from '@/api/account';
import { useAccountSession } from '@/capabilities/account';
import type { HistoryRow } from '../../_model/attempt-history';
import { buildOwnDisplayModel, type OwnDisplayModel } from '../../_model/own-bid-points';
import { OwnBidContext, type OwnBidStatus, type OwnBidValue } from './own-bid-context';

const NO_BUSINESSES: readonly RegisteredBusiness[] = [];
// 비활성 query의 key 자리다. enabled가 false라 요청은 나가지 않고 path parse도 queryFn 안에서만 일어난다.
const NO_SCOPE: PrivateWorkspaceScope = { principalId: '', workspaceId: '' };

type StatusInput = {
  readonly account: ReturnType<typeof useAccountSession>;
  readonly scope: PrivateWorkspaceScope | null;
  readonly businessesQuery: UseQueryResult<MyBusinessesV1Response>;
  readonly businesses: readonly RegisteredBusiness[];
  readonly businessId: string | null;
  readonly historyReady: boolean;
  readonly attemptCount: number;
  readonly observations: UseQueryResult<MyBidObservationsV1Response>;
  readonly display: OwnDisplayModel | null;
};

/** 상태 판정은 순수하게 둔다. 순서가 곧 우선순위다 — 로그인보다 앞선 사실(의존성 없음)이 먼저다. */
function deriveStatus(input: StatusInput): OwnBidStatus {
  const { account, scope, businessesQuery, businesses, businessId, observations } = input;
  if (isAccountDependencyUnavailableError(account.error)) return { kind: 'auth-unavailable' };
  if (account.isPending || account.session === undefined) return { kind: 'checking' };
  if (account.session.state === 'unauthenticated') return { kind: 'signed-out' };
  if (account.session.state === 'uninitialized' || scope === null) return { kind: 'uninitialized' };
  if (businessesQuery.isPending) return { kind: 'checking' };
  if (businessesQuery.isError) return { kind: 'error', retry: () => void businessesQuery.refetch() };
  if (businesses.length === 0) return { kind: 'no-businesses' };
  if (businessId === null) return { kind: 'select-business' };
  if (!input.historyReady || input.attemptCount === 0) return { kind: 'history-not-ready' };
  if (observations.isPending) return { kind: 'loading' };
  if (observations.isError) {
    if (isBidObservationsBuildChangedError(observations.error)) return { kind: 'build-changed' };
    return { kind: 'error', retry: () => void observations.refetch() };
  }
  const supplier = observations.data.supplier;
  if (supplier.kind === 'unobserved') return { kind: 'unobserved' };
  if (supplier.kind === 'evidence-conflict') return { kind: 'evidence-conflict' };
  return input.display === null ? { kind: 'loading' } : { kind: 'observed', display: input.display };
}

export function OwnBidProvider({
  organizationId,
  buildId,
  rows,
  children
}: {
  readonly organizationId: string | null;
  readonly buildId: string | null;
  /** 차트가 그리는 첫 페이지 표본이다. 더 불러온 페이지의 회차는 묻지 않는다(인계 원문). */
  readonly rows: readonly HistoryRow[];
  readonly children: ReactNode;
}) {
  const account = useAccountSession();
  const session = account.session;
  const principalId = session?.state === 'active' ? session.principalId : null;
  const scope = useMemo<PrivateWorkspaceScope | null>(
    () => (session?.state === 'active' ? { principalId: session.principalId, workspaceId: session.workspace.workspaceId } : null),
    [session]
  );
  const businessesQuery = useQuery({ ...accountQueries.businesses(scope ?? NO_SCOPE), enabled: scope !== null });
  const businesses = businessesQuery.data?.businesses ?? NO_BUSINESSES;

  // 선택은 principal에 매인다. 계정이 바뀌면 같은 businessId라도 남의 등록이라 값이 스스로 비워지고,
  // 등록 목록에서 사라진 선택도 남지 않는다.
  const [choice, setChoice] = useState<{ readonly principalId: string; readonly businessId: string } | null>(null);
  const chosen =
    choice !== null && choice.principalId === principalId && businesses.some((business) => business.businessId === choice.businessId)
      ? choice.businessId
      : null;
  // 등록이 하나면 고르라고 요구하지 않는다. 여럿이면 기본값을 두지 않는다 — 화면이 고른 사업자는 사용자 결정이 아니다.
  const businessId = businesses.length === 1 ? businesses[0]!.businessId : chosen;

  const attempts = useMemo<readonly BidObservationAttemptKey[]>(
    () =>
      rows
        .filter((row) => row.openedAt != null && row.revisionId !== null)
        .map((row) => ({ attemptId: row.attemptId, revisionId: row.revisionId! })),
    [rows]
  );
  // revision이 하나라도 없으면 서버가 opt-in을 무시한 응답이다. 최신 revision으로 추정해 묻지 않는다.
  const historyReady = rows.length > 0 && rows.every((row) => row.revisionId !== null) && organizationId !== null && buildId !== null;
  const enabled = scope !== null && businessId !== null && historyReady && attempts.length > 0;
  const observations = useQuery({
    ...accountQueries.bidObservations(scope ?? NO_SCOPE, {
      businessId: businessId ?? '',
      organizationId: organizationId ?? '',
      buildId: buildId ?? '',
      attempts
    }),
    enabled
  });
  const display = useMemo(
    () => (observations.data?.supplier.kind === 'observed' ? buildOwnDisplayModel(rows, observations.data.supplier.attempts) : null),
    [observations.data, rows]
  );
  const status = deriveStatus({
    account,
    scope,
    businessesQuery,
    businesses,
    businessId,
    historyReady,
    attemptCount: attempts.length,
    observations,
    display
  });
  const select = useCallback(
    (next: string) => {
      if (principalId !== null) setChoice({ principalId, businessId: next });
    },
    [principalId]
  );
  const value = useMemo<OwnBidValue>(
    () => ({
      status,
      businesses,
      selectedBusinessId: businessId,
      select,
      // 관측 상태에서만 점을 준다. 사업자·계정을 바꾸는 사이 이전 응답의 점이 캔버스에 남지 않게 한다.
      display: status.kind === 'observed' ? status.display : null
    }),
    [status, businesses, businessId, select]
  );
  return <OwnBidContext.Provider value={value}>{children}</OwnBidContext.Provider>;
}
