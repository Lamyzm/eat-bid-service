import type { RequestMeta } from '@/shell/providers/query-client';

// 모든 Query와 Mutation이 동일한 오류 표시 계약을 사용하도록 TanStack 전역 타입을 닫는다.
declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: RequestMeta;
    mutationMeta: RequestMeta;
  }
}
