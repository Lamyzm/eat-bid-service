/** @module 책임: 등록 사업자 하나의 사업장 주소 직접 입력·저장·삭제와 그 pending·실패 문구를 소유한다. */
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import {
  accountQueries,
  clearMyBusinessLocation,
  setMyBusinessLocation,
  type PrivateWorkspaceScope,
  type RegisteredBusiness
} from '@/api/account';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { LoadingButton } from '@/shared/ui/loading-button';

interface BusinessLocationFormProps {
  readonly business: RegisteredBusiness;
  readonly scope: PrivateWorkspaceScope;
  readonly canWrite: boolean;
}

export function BusinessLocationForm({ business, scope, canWrite }: BusinessLocationFormProps) {
  const client = useQueryClient();
  const inputId = useId();
  const messageId = useId();
  const [value, setValue] = useState(business.location?.addressText ?? '');

  const invalidate = () =>
    client.invalidateQueries({ queryKey: accountQueries.businesses(scope).queryKey });

  const save = useMutation({
    mutationFn: (addressText: string) =>
      setMyBusinessLocation({ businessId: business.businessId, addressText }),
    onSuccess: invalidate
  });
  const clear = useMutation({
    mutationFn: () => clearMyBusinessLocation({ businessId: business.businessId }),
    onSuccess: () => {
      setValue('');
      return invalidate();
    }
  });

  const pending = save.isPending || clear.isPending;
  const trimmed = value.trim();
  const failed = save.isError || clear.isError;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    // 비운 입력은 빈 문자열 저장이 아니라 미설정으로 되돌리는 별도 command다(ADR 0032 §8).
    if (trimmed === '') {
      if (business.location !== null) clear.mutate();
      return;
    }
    save.mutate(trimmed);
  }

  return (
    <form onSubmit={submit} className='grid gap-2'>
      <Label htmlFor={inputId}>사업장 주소 (선택)</Label>
      <div className='flex flex-wrap gap-2'>
        <Input
          id={inputId}
          value={value}
          autoComplete='off'
          placeholder='예: 서울특별시 중구 세종대로 110'
          className='min-w-0 flex-1'
          disabled={!canWrite}
          aria-describedby={messageId}
          onChange={(event) => setValue(event.target.value)}
        />
        <LoadingButton
          type='submit'
          loading={pending}
          loadingLabel='저장 중…'
          disabled={!canWrite}
        >
          저장
        </LoadingButton>
        {business.location !== null ? (
          <Button
            type='button'
            variant='outline'
            disabled={!canWrite || pending}
            onClick={() => clear.mutate()}
          >
            주소 지우기
          </Button>
        ) : null}
      </div>
      <p id={messageId} role={failed ? 'alert' : undefined} className='text-xs text-muted-foreground'>
        {failed ? '주소를 저장하지 못했습니다. 다시 시도해 주세요.' : '주소는 직접 입력합니다.'}
      </p>
    </form>
  );
}
