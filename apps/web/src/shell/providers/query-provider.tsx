'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

import { getQueryClient } from './query-client';

// 운영 bundle에는 개발 도구를 포함하지 않도록 별도 client chunk로 늦게 불러온다.
const ReactQueryDevtools = dynamic(
  () => import('@tanstack/react-query-devtools').then((module) => module.ReactQueryDevtools),
  { ssr: false }
);

export function shouldMountQueryDevtools(nodeEnvironment: string | undefined): boolean {
  return nodeEnvironment === 'development';
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {shouldMountQueryDevtools(process.env.NODE_ENV) ? <ReactQueryDevtools /> : null}
    </QueryClientProvider>
  );
}
