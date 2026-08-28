'use client';
/** Better Auth 클라이언트 — 서버 basePath /api/auth */
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
  basePath: '/api/auth',
});

export const signInGoogle = () =>
  authClient.signIn.social({ provider: 'google', callbackURL: window.location.href });

/** 로그아웃 — wipe=true면 이 브라우저에 남은 기록도 삭제 (기본: 유지) */
export const signOut = async (wipe = false) => {
  try { await authClient.signOut(); } catch {}
  if (wipe) {
    const { clearLocalData } = await import('@/lib/session');
    clearLocalData();
  }
  window.location.reload();
};
