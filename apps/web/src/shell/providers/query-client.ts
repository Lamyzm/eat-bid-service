import {
  MutationCache,
  QueryCache,
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer
} from '@tanstack/react-query';
import { toast } from 'sonner';

export type ErrorPresentation = 'toast' | 'inline' | 'silent';

/** Query meta에는 표시 정책과 안전한 메시지 식별자만 두고 업무 값과 서버 응답을 싣지 않는다. */
export type RequestMeta = {
  errorPresentation: ErrorPresentation;
  successMessageId?: string;
  errorMessageId?: string;
};

export interface QueryClientPorts {
  readonly notify: (messageId: string) => void;
  readonly report: (error: unknown) => void;
}

export interface QueryClientResolverOptions {
  readonly isServer: boolean;
  readonly ports: QueryClientPorts;
}

const QUERY_STALE_TIME_MILLISECONDS = 60_000;
const DEFAULT_REQUEST_FAILURE_MESSAGE_ID = 'common.request-failed';

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function reportRequestError(
  error: unknown,
  meta: RequestMeta | undefined,
  ports: QueryClientPorts
): void {
  if (isAbortError(error)) return;
  ports.report(error);
  if (meta?.errorPresentation === 'toast') {
    ports.notify(meta.errorMessageId ?? DEFAULT_REQUEST_FAILURE_MESSAGE_ID);
  }
}

export function createQueryClient(ports: QueryClientPorts): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => reportRequestError(error, query.meta, ports)
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _onMutateResult, mutation) =>
        reportRequestError(error, mutation.meta, ports)
    }),
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MILLISECONDS
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending'
      }
    }
  });
}

export function createQueryClientResolver(options: QueryClientResolverOptions): () => QueryClient {
  let browserQueryClient: QueryClient | undefined;
  return () => {
    // 서버 요청끼리 cache가 섞이지 않게 매번 만들고, 브라우저에서는 화면 전환에도 같은 cache를 유지한다.
    if (options.isServer) return createQueryClient(options.ports);
    browserQueryClient ??= createQueryClient(options.ports);
    return browserQueryClient;
  };
}

const applicationPorts: QueryClientPorts = {
  notify: (messageId) => {
    toast.error('요청을 처리하지 못했습니다.', { id: messageId });
  },
  report: (error) => {
    // 정상 경로의 초기 bundle에는 관측 SDK를 싣지 않고 실제 오류가 생겼을 때만 불러온다.
    void import('@sentry/nextjs')
      .then(({ captureException }) => captureException(error))
      .catch(() => undefined);
  }
};

const resolveQueryClient = createQueryClientResolver({ isServer, ports: applicationPorts });

export function getQueryClient(): QueryClient {
  return resolveQueryClient();
}
