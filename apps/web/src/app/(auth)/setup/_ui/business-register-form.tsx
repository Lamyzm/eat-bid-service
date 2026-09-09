/** @module 책임: 사업자등록번호 입력과 등록 command 하나의 검증·pending·실패 문구를 소유한다. */
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import {
  accountQueries,
  isRegisteredBusinessConflictError,
  registerMyBusiness,
  type PrivateWorkspaceScope
} from '@/api/account';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { LoadingButton } from '@/shared/ui/loading-button';

import { checkBusinessNumberInput } from '../_model/registered-business-view';

interface BusinessRegisterFormProps {
  readonly scope: PrivateWorkspaceScope;
  /** owner만 등록할 수 있다. 서버가 최종 판정하므로 화면은 이유를 말할 뿐 판정을 대신하지 않는다. */
  readonly canWrite: boolean;
}

function failureText(error: unknown): string {
  if (isRegisteredBusinessConflictError(error)) {
    return '이미 등록된 사업자이거나 등록 가능한 수를 넘었습니다.';
  }
  return '등록하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
}

export function BusinessRegisterForm({ scope, canWrite }: BusinessRegisterFormProps) {
  const client = useQueryClient();
  const inputId = useId();
  const messageId = useId();
  const [value, setValue] = useState('');
  const [formatMessage, setFormatMessage] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: (businessNumber: string) => registerMyBusiness({ businessNumber }),
    onSuccess: () => {
      setValue('');
      setFormatMessage(null);
      return client.invalidateQueries({ queryKey: accountQueries.businesses(scope).queryKey });
    }
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // pending 중 재제출을 막는다. 같은 번호의 두 번째 등록은 서버에서 409가 되지만 그 전에 화면이 멈춘다.
    if (register.isPending) return;
    const checked = checkBusinessNumberInput(value);
    if (!checked.ok) {
      setFormatMessage(checked.message);
      return;
    }
    setFormatMessage(null);
    register.mutate(checked.businessNumber);
  }

  const message = formatMessage ?? (register.isError ? failureText(register.error) : null);

  return (
    <form onSubmit={submit} className='grid gap-2'>
      <Label htmlFor={inputId}>사업자등록번호</Label>
      <div className='flex flex-wrap gap-2'>
        <Input
          id={inputId}
          value={value}
          inputMode='numeric'
          autoComplete='off'
          placeholder='숫자 열 자리 또는 123-45-67890'
          className='max-w-60 font-mono'
          disabled={!canWrite}
          aria-describedby={message === null ? undefined : messageId}
          aria-invalid={message === null ? undefined : true}
          onChange={(event) => setValue(event.target.value)}
        />
        <LoadingButton
          type='submit'
          loading={register.isPending}
          loadingLabel='등록 중…'
          disabled={!canWrite || value.trim() === ''}
        >
          등록
        </LoadingButton>
      </div>
      <p id={messageId} role={message === null ? undefined : 'alert'} className='text-sm text-destructive'>
        {message}
      </p>
      <p className='text-xs text-muted-foreground'>
        아직 공고 기록에 없는 번호도 등록할 수 있습니다.
      </p>
    </form>
  );
}
