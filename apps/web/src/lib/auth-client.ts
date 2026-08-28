'use client';
/** Better Auth 클라이언트 — 서버 basePath /api/auth */
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
  basePath: '/api/auth',
});

export const signInGoogle = () =>
  authClient.signIn.social({ provider: 'google', callbackURL: window.location.href });

export const signOut = () => authClient.signOut().finally(() => window.location.reload());
