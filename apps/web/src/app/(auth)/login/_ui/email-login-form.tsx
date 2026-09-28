/** @module 책임: 이메일·비밀번호 입력과 로그인 command 하나의 pending·실패 문구, 로컬 dev의 시드 계정 자동 제출을 소유한다. */
'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { LoadingButton } from '@/shared/ui/loading-button';
import { signInWithEmail } from '@/shell/auth/auth-client';

import { DEV_LOGIN_ACCOUNT } from '../_model/dev-login';

interface EmailLoginFormProps {
  /** 서버가 이미 같은 앱 상대 경로로 좁힌 값이다. 화면은 이 값을 그대로 provider에 넘긴다. */
  readonly returnPath: string;
  /** 인증 의존성이 없는 배포에서는 Google 버튼과 같은 이유로 제출할 수 없다. */
  readonly disabled: boolean;
  /** 로컬 dev에서 시드 계정으로 한 번 스스로 제출한다. 실패하면 폼과 실패 문구가 그대로 남는다. */
  readonly autoSubmit?: boolean;
}

type Failure = 'none' | 'invalid-credentials' | 'failed';

function failureText(failure: Failure): string | null {
  switch (failure) {
    case 'none':
      return null;
    case 'invalid-credentials':
      return '이메일 또는 비밀번호를 확인해 주세요.';
    case 'failed':
      return '로그인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
  }
}

export function EmailLoginForm({ returnPath, disabled, autoSubmit = false }: EmailLoginFormProps) {
  const emailId = useId();
  const passwordId = useId();
  const messageId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure>('none');

  const signIn = useCallback(async (credentials: { readonly email: string; readonly password: string }) => {
    // pending 중 재제출을 막는다. 성공 뒤에는 provider가 복귀 경로로 브라우저를 옮기므로 pending을 유지한다.
    if (pending) return;
    setPending(true);
    setFailure('none');
    try {
      const outcome = await signInWithEmail({ ...credentials, returnPath });
      if (outcome === 'invalid-credentials') {
        setFailure('invalid-credentials');
        setPending(false);
      }
    } catch {
      // 원인 문자열에는 요청 식별자가 섞일 수 있어 실패했다는 사실만 말한다.
      setFailure('failed');
      setPending(false);
    }
  }, [pending, returnPath]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await signIn({ email, password });
  }

  // 자동 제출은 화면이 붙은 뒤 한 번뿐이다. 실패한 뒤 다시 제출하면 같은 실패를 되풀이하며 문구가 깜박인다.
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (!autoSubmit || disabled || autoSubmitted.current) return;
    autoSubmitted.current = true;
    setEmail(DEV_LOGIN_ACCOUNT.email);
    setPassword(DEV_LOGIN_ACCOUNT.password);
    void signIn(DEV_LOGIN_ACCOUNT);
    // pending이 바뀌면 signIn이 새로 만들어져 효과가 다시 돌지만, 위 ref가 첫 제출 하나만 남긴다.
  }, [autoSubmit, disabled, signIn]);

  const message = failureText(failure);
  const describedBy = message === null ? undefined : messageId;

  return (
    <form onSubmit={(event) => void submit(event)} aria-label='이메일 로그인' className='grid gap-3'>
      <div className='grid gap-2'>
        <Label htmlFor={emailId}>이메일</Label>
        <Input
          id={emailId}
          type='email'
          autoComplete='email'
          value={email}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className='grid gap-2'>
        <Label htmlFor={passwordId}>비밀번호</Label>
        <Input
          id={passwordId}
          type='password'
          autoComplete='current-password'
          value={password}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <p id={messageId} role={message === null ? undefined : 'alert'} className='text-sm text-destructive'>
        {message}
      </p>
      <LoadingButton
        type='submit'
        variant='outline'
        loading={pending}
        loadingLabel='로그인 중…'
        disabled={disabled || email.trim() === '' || password === ''}
      >
        이메일로 로그인
      </LoadingButton>
    </form>
  );
}
