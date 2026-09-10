/** @module 책임: layout이 넘기는 계정 슬롯을 서버가 읽은 세션과 함께 조립해 브라우저가 같은 답을 다시 묻지 않게 한다. */
import { Suspense } from 'react';

import { getCurrentSessionFromServer } from '@/api/account/server';
import { Button } from '@/shared/ui/button';

import { AccountHub } from './account-hub';
import { AccountSlotFace } from './account-slot-face';

/**
 * 대기 자리는 세션을 읽지 않는다. 여기에 조회하는 컴포넌트를 두면 streaming 중에 그것이 먼저 붙어,
 * 서버가 이미 읽은 답이 도착하기 전에 브라우저가 같은 조회를 한 번 더 보낸다.
 */
function AccountSlotPending() {
  return (
    <Button variant='ghost' className='h-12 w-full justify-start px-2' disabled>
      <AccountSlotFace title='계정 확인 중' detail='' />
    </Button>
  );
}

async function ServerSessionAccountHub() {
  const read = await getCurrentSessionFromServer();
  // 인증 의존성이 없는 배포는 넘길 답이 없다. 그 사실은 브라우저의 같은 조회가 실패 상태로 말한다.
  return <AccountHub initialSession={read.kind === 'session' ? read.response : undefined} />;
}

/**
 * 세션을 읽는 자리를 Suspense 안에 가두어 shell과 page의 static 부분을 dynamic 경계로 끌어들이지
 * 않는다(ADR 0028 2항). 같은 요청의 다른 자리(업무 게이트, 설정 loader)가 이미 읽었으면
 * `getCurrentSessionFromServer`의 요청 범위 memo가 그 답을 그대로 돌려준다.
 */
export function AccountHubSlot() {
  return (
    <Suspense fallback={<AccountSlotPending />}>
      <ServerSessionAccountHub />
    </Suspense>
  );
}
