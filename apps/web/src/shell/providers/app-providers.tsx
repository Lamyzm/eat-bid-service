/** @module 책임: client 전역 context provider의 순서와 단일 소유권을 application 경계에 고정한다. */
'use client';

import type { ReactNode } from 'react';

import { QueryProvider } from './query-provider';

export function AppProviders({ children }: { readonly children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
