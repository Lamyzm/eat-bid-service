import { describe, expect, test } from 'bun:test';
import { MutationObserver, dehydrate } from '@tanstack/react-query';

import {
  createQueryClient,
  createQueryClientResolver,
  type QueryClientPorts
} from './query-client';
import { shouldMountQueryDevtools } from './query-provider';

function recordingPorts() {
  const notifications: string[] = [];
  const reports: unknown[] = [];
  const ports: QueryClientPorts = {
    notify: (messageId) => notifications.push(messageId),
    report: (error) => reports.push(error)
  };
  return { notifications, reports, ports };
}

async function rejectQuery(
  client: ReturnType<typeof createQueryClient>,
  key: string,
  error: unknown,
  errorPresentation: 'toast' | 'inline' | 'silent',
  errorMessageId?: string
) {
  await client
    .fetchQuery({
      queryKey: [key],
      queryFn: async () => {
        throw error;
      },
      retry: false,
      meta: { errorPresentation, errorMessageId }
    })
    .catch(() => undefined);
}

describe('전역 Query와 Mutation 정책', () => {
  test('toast Query와 Mutation 실패는 notifier와 telemetry를 각각 한 번 호출한다', async () => {
    const { notifications, reports, ports } = recordingPorts();
    const client = createQueryClient(ports);
    const queryError = new Error('조회 실패');
    const mutationError = new Error('저장 실패');

    await rejectQuery(client, 'toast-query', queryError, 'toast', 'auction.load-failed');
    const mutation = new MutationObserver(client, {
      mutationKey: ['toast-mutation'],
      mutationFn: async () => {
        throw mutationError;
      },
      retry: false,
      meta: {
        errorPresentation: 'toast',
        errorMessageId: 'auction.save-failed'
      }
    });
    await mutation.mutate().catch(() => undefined);

    expect(notifications).toEqual(['auction.load-failed', 'auction.save-failed']);
    expect(reports).toEqual([queryError, mutationError]);
  });

  test('inline과 silent 실패는 toast하지 않지만 telemetry에는 보고한다', async () => {
    const { notifications, reports, ports } = recordingPorts();
    const client = createQueryClient(ports);
    const inlineError = new Error('화면 내부 오류');
    const silentError = new Error('조용한 오류');

    await rejectQuery(client, 'inline-query', inlineError, 'inline');
    await rejectQuery(client, 'silent-query', silentError, 'silent');

    expect(notifications).toEqual([]);
    expect(reports).toEqual([inlineError, silentError]);
  });

  test('abort 오류는 toast와 telemetry에서 모두 제외한다', async () => {
    const { notifications, reports, ports } = recordingPorts();
    const client = createQueryClient(ports);

    await rejectQuery(
      client,
      'aborted-query',
      new DOMException('요청 취소', 'AbortError'),
      'toast',
      'auction.load-failed'
    );

    expect(notifications).toEqual([]);
    expect(reports).toEqual([]);
  });

  test('기본 stale time과 pending dehydration 정책을 보존한다', async () => {
    const client = createQueryClient(recordingPorts().ports);
    let resolveQuery: ((value: string) => void) | undefined;
    const pending = client.fetchQuery({
      queryKey: ['pending-query'],
      queryFn: () =>
        new Promise<string>((resolve) => {
          resolveQuery = resolve;
        })
    });

    expect(client.getDefaultOptions().queries?.staleTime).toBe(60_000);
    expect(dehydrate(client).queries.map((query) => query.queryKey)).toContainEqual([
      'pending-query'
    ]);
    resolveQuery?.('완료');
    await pending;
  });

  test('server resolver는 매번 새 client를 만들고 browser resolver는 하나를 재사용한다', () => {
    const ports = recordingPorts().ports;
    const getServerClient = createQueryClientResolver({ isServer: true, ports });
    const getBrowserClient = createQueryClientResolver({ isServer: false, ports });

    expect(getServerClient()).not.toBe(getServerClient());
    expect(getBrowserClient()).toBe(getBrowserClient());
  });

  test('React Query Devtools는 development에서만 활성화한다', () => {
    expect(shouldMountQueryDevtools('development')).toBe(true);
    expect(shouldMountQueryDevtools('production')).toBe(false);
    expect(shouldMountQueryDevtools('test')).toBe(false);
  });

  test('Request meta는 표시 정책과 안전한 메시지 ID 이외의 payload를 허용하지 않는다', () => {
    const client = createQueryClient(recordingPorts().ports);
    const assertMetaContract = () => {
      client.setQueryDefaults(['valid-meta'], {
        meta: { errorPresentation: 'inline', errorMessageId: 'auction.load-failed' }
      });
      client.setQueryDefaults(['invalid-meta'], {
        // @ts-expect-error 업무 값은 Query meta 계약에 들어갈 수 없다.
        meta: { errorPresentation: 'silent', bidValue: '99.9' }
      });
    };

    expect(typeof assertMetaContract).toBe('function');
  });
});
