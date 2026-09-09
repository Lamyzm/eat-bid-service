/** @module 책임: Google 로그인 시작 하나만 담은 진입 화면과 그 실패·미설정 상태를 렌더한다. */
'use client';

import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { LoadingButton } from '@/shared/ui/loading-button';
import { signInWithGoogle } from '@/shell/auth/auth-client';

interface LoginScreenProps {
  /** 서버가 이미 같은 앱 상대 경로로 좁힌 값이다. 화면은 이 값을 그대로 provider에 넘긴다. */
  readonly returnPath: string;
  /** 인증 의존성이 없는 배포는 "로그인하지 않음"과 다른 사실이라 버튼을 눌러도 되는 상태가 아니다. */
  readonly authUnavailable: boolean;
  /** 로그인 뒤 돌아갈 화면이 정해져 있으면 그 사실만 문장으로 알린다. */
  readonly hasReturnScreen: boolean;
}

export function LoginScreen({ returnPath, authUnavailable, hasReturnScreen }: LoginScreenProps) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function start() {
    setPending(true);
    setFailed(false);
    try {
      await signInWithGoogle(returnPath);
    } catch {
      // provider로 넘어가지 못했다는 사실만 말한다. 원인 문자열에는 요청 식별자와 토큰이 섞일 수 있다.
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div
      data-slot='login-screen'
      role='region'
      aria-labelledby='login-title'
      className='mx-auto grid w-full max-w-md gap-4 px-3 py-10 sm:px-4'
    >
      <Card>
        <CardHeader>
          <CardTitle id='login-title' className='text-xl'>로그인</CardTitle>
          <CardDescription>
            Google 계정으로 로그인하면 사업자를 등록할 수 있습니다. 공고와 개찰 기록은 로그인 없이도
            그대로 볼 수 있습니다.
            {hasReturnScreen ? ' 로그인하면 보던 화면으로 돌아갑니다.' : null}
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-3'>
          {authUnavailable ? (
            <Alert variant='destructive'>
              <AlertTitle>지금은 로그인할 수 없습니다</AlertTitle>
              <AlertDescription>잠시 뒤 다시 시도해 주세요.</AlertDescription>
            </Alert>
          ) : null}
          {failed ? (
            <Alert variant='destructive'>
              <AlertTitle>Google로 넘어가지 못했습니다</AlertTitle>
              <AlertDescription>네트워크를 확인한 뒤 다시 시도해 주세요.</AlertDescription>
            </Alert>
          ) : null}
          <LoadingButton
            loading={pending}
            loadingLabel='Google로 이동 중…'
            disabled={authUnavailable}
            onClick={() => void start()}
          >
            Google로 로그인
          </LoadingButton>
        </CardContent>
      </Card>
    </div>
  );
}
