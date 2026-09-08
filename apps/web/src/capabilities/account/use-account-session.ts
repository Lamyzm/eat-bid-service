/** @module 책임: provider 세션 수명주기와 canonical 세션 상태를 한 hook으로 묶고 계정이 바뀌면 이전 계정의 답과 개인 캐시를 즉시 버린다. */
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
import { signOutFromProvider, useProviderSubject } from '@/shell/auth/auth-client';

export interface AccountSessionView {
  readonly session: CurrentSessionV1Response | undefined;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly principalId: string | null;
  readonly refetch: () => void;
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
export function useAccountSession(): AccountSessionView {
  const client = useQueryClient();
  const subject = useProviderSubject();
  const session = useQuery(accountQueries.session(subject));

  useEffect(() => {
    // 관측 전에는 버릴 기준이 없다. 여기서 지우면 아직 유효한 답을 이유 없이 다시 묻는다.
    if (subject === undefined) return;
    void discardOtherSubjects(client, subject);
  }, [client, subject]);

  const principalId = session.data?.state === 'active' ? session.data.principalId : null;
  useEffect(() => {
    // 새 계정의 화면이 앞 사람의 사업장 주소나 번호를 한순간도 보여 주지 않게 한다. 전환 직후에는
    // 세션 답이 비어 principal이 `null`이므로 이전 계정의 개인 자료가 그 자리에서 전부 사라진다.
    void discardOtherPrincipals(client, principalId);
  }, [client, principalId]);

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
