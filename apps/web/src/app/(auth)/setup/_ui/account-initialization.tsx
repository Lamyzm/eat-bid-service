/** @module 책임: 로그인은 됐지만 app 계정 관계가 없는 상태에서 명시적 시작 command와 그 재시도를 렌더한다. */
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { accountQueries, initializeCurrentAccount } from '@/api/account';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { LoadingButton } from '@/shared/ui/loading-button';

export function AccountInitialization({ accountLabel }: { readonly accountLabel: string }) {
  const client = useQueryClient();
  const initialize = useMutation({
    mutationFn: () => initializeCurrentAccount(),
    // 성공 판정은 서버 응답이 하고, 화면은 세션 답을 다시 물어 그 결과로 다음 상태를 그린다.
    // 주체가 다른 세션 답이 캐시에 남아 있어도 무효화는 지금 주체의 항목에만 닿아야 하므로 prefix로 부른다.
    onSuccess: () => client.invalidateQueries({ queryKey: accountQueries.sessionRoot() })
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>시작하기</CardTitle>
        <CardDescription>
          {accountLabel} 계정으로 로그인했습니다. 시작하기를 누르면 사업자를 등록할 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-3'>
        {initialize.isError ? (
          <Alert variant='destructive'>
            <AlertTitle>시작하지 못했습니다</AlertTitle>
            <AlertDescription>다시 시도해 주세요.</AlertDescription>
          </Alert>
        ) : null}
        <LoadingButton
          loading={initialize.isPending}
          loadingLabel='시작하는 중…'
          onClick={() => initialize.mutate()}
        >
          시작하기
        </LoadingButton>
      </CardContent>
    </Card>
  );
}
