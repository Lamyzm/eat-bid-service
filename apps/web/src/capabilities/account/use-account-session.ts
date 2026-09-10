/**
 * @module 책임: provider 세션 수명주기와 canonical 세션 상태를 한 hook으로 묶고, 서버가 이미 읽은 답을
 * 첫 값으로 이어받되 계정이 바뀌면 이전 계정의 답과 개인 캐시를 즉시 버린다.
 */
'use client';

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  accountQueries,
  discardAccountCache,
  discardOtherPrincipals,
  discardOtherSubjects,
  type CurrentSessionV1Response
} from '@/api/account';
import {
  signOutFromProvider,
  useProviderSubject,
  type ProviderSubject
} from '@/shell/auth/auth-client';

export interface AccountSessionView {
  readonly session: CurrentSessionV1Response | undefined;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly principalId: string | null;
  readonly refetch: () => void;
}

/**
 * 서버가 넘긴 답 하나가 이미 쓰였는지 표시한다. 서버 렌더마다 새 응답 값이 오므로 값의 정체성이 곧
 * "그 요청의 답"이고, 쓰고 나면 다시 쓰지 않는다. React state로 세지 않는 이유는 이 사실이 컴포넌트
 * 수명이 아니라 응답 하나에 붙기 때문이다 — 같은 답을 두 자리(계정 슬롯, 설정 화면)가 함께 받는다.
 * 약한 참조라 응답이 사라지면 표시도 함께 사라진다.
 */
const usedServerSessions = new WeakSet<CurrentSessionV1Response>();

/**
 * 서버가 이 요청의 쿠키로 이미 읽은 답을 브라우저 캐시의 첫 값으로 놓는다. 조회를 하나 더 만들지 않고
 * 게이트가 읽은 그 답을 그대로 쓰는 것이 목적이므로, 이 자리를 지나면 `queryFn`이 불리지 않는다.
 *
 * `HydrationBoundary`를 쓰지 않는 이유는 key의 마지막 자리가 브라우저만 아는 값이기 때문이다. 세션
 * key의 주체는 provider가 관측해야 정해지고 서버는 그 값을 모른다. 그래서 dehydrate한 상태를 서버에서
 * 만들 수 없고, 주체가 밝혀지는 순간 그 key에 답을 놓는다.
 *
 * 한 번만 놓는 이유는 이 답이 "그 요청의 쿠키 주체"에 대한 답이기 때문이다. 주체를 처음 관측한 뒤
 * 계정이 바뀌면 그 답은 다른 사람의 것이므로 두 번째 주체부터는 놓지 않고 서버에 다시 묻는다
 * (ADR 0032 §9). 아직 주체를 모르는 동안에도 놓지 않는다. 그때 놓으면 미관측 자리(`null`)가 채워져
 * 주체가 밝혀진 뒤 그 값이 영영 읽히지 않는다.
 */
function plantServerSession(
  client: QueryClient,
  subject: ProviderSubject,
  serverSession: CurrentSessionV1Response | undefined
): void {
  if (subject === undefined || serverSession === undefined) return;
  if (usedServerSessions.has(serverSession)) return;
  usedServerSessions.add(serverSession);
  const { queryKey } = accountQueries.session(subject);
  // 브라우저가 이미 답을 받아 두었으면 서버가 읽은 시점으로 되돌리지 않는다. 항목의 존재가 아니라 답이
  // 있는지를 보는 이유는, 주체를 모르는 동안 만들어진 빈 항목이 미로그인 주체와 같은 자리를 쓰기 때문이다.
  if ((client.getQueryState(queryKey)?.dataUpdatedAt ?? 0) === 0) {
    client.setQueryData(queryKey, serverSession);
  }
}

/**
 * 두 소유자를 한 자리에서 조립하되 합치지는 않는다. provider hook은 세션 수명주기(갱신 POST와 다른 탭의
 * 로그인·로그아웃)를 소유하고, canonical union은 app principal과 워크스페이스 상태를 소유한다. provider가
 * 준 사용자 id는 캐시 주체를 가르는 전환 marker로만 쓰며 app 주체로 저장하지 않는다(ADR 0032 §2·§9).
 *
 * 전환 처리는 이 hook 하나가 책임진다. 소비자마다 다시 발명하면 같은 전환에서 화면끼리 다른 계정을
 * 보게 된다. 전환은 세션 query key의 주체가 바뀌는 것으로 표현하므로, 전환된 렌더가 곧 "아직 모른다"
 * 이고 이전 계정의 답이 남아 있는 중간 상태가 존재할 수 없다.
 */
export function useAccountSession(
  /** 업무 layout과 설정 route가 서버에서 읽어 넘긴 같은 요청의 답이다. 없으면 브라우저가 직접 묻는다. */
  serverSession?: CurrentSessionV1Response
): AccountSessionView {
  const client = useQueryClient();
  const subject = useProviderSubject();
  plantServerSession(client, subject, serverSession);
  const session = useQuery(accountQueries.session(subject));

  useEffect(() => {
    // 관측 전에는 버릴 기준이 없다. 여기서 지우면 아직 유효한 답을 이유 없이 다시 묻는다.
    if (subject === undefined) return;
    void discardOtherSubjects(client, subject);
  }, [client, subject]);

  const principalId = session.data?.state === 'active' ? session.data.principalId : null;
  useEffect(() => {
    // 여기서도 관측 전에는 버릴 기준이 없다. 아직 주체를 모르는 첫 렌더의 `null`을 전환으로 읽으면,
    // 서버가 같은 요청에서 읽어 넘긴 개인 자료가 화면에 닿기도 전에 사라진다.
    if (subject === undefined) return;
    // 새 계정의 화면이 앞 사람의 사업장 주소나 번호를 한순간도 보여 주지 않게 한다. 전환 직후에는
    // 세션 답이 비어 principal이 `null`이므로 이전 계정의 개인 자료가 그 자리에서 전부 사라진다.
    void discardOtherPrincipals(client, principalId);
  }, [client, principalId, subject]);

  return {
    session: session.data,
    // provider 주체를 아직 모르는 동안 query는 idle이다. 화면에는 "확인 중"과 같은 사실이다.
    isPending: session.isPending,
    error: session.error,
    principalId,
    refetch: () => void session.refetch()
  };
}

/**
 * 로그아웃 순서를 여기 하나로 고정한다. provider 무효화가 실패하면 그 오류를 그대로 던져 화면이
 * 로그아웃됐다고 말하지 못하게 하고, 성공했을 때만 개인 자료와 이전 계정의 세션 답을 함께 버린다.
 */
export async function signOutAndDiscardAccountCache(client: QueryClient): Promise<void> {
  await signOutFromProvider();
  await discardAccountCache(client);
}
