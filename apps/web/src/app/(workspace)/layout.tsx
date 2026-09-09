/**
 * @module 책임: canonical 업무 route를 공통 application chrome에 연결하고, 그 안에서는 세션이 항상
 * 활성이 되도록 세션 계약을 읽어 로그인·설정으로 돌려보내는 게이트를 함께 건다.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { getCurrentSessionFromServer } from '@/api/account/server';
import { AccountHub } from '@/capabilities/account';
import {
  RETURN_PATH_HEADER,
  loginRouteWithReturn,
  setupRouteWithReturn
} from '@/shell/auth/return-path';
import { ApplicationShell } from '@/shell/layout/application-shell';

import { workspaceGateDecision } from './_model/session-gate';

/**
 * 쿠키가 없는 요청은 proxy가 먼저 돌려보내므로 여기 도달하는 것은 쿠키는 있는데 세션이 활성이 아닌
 * 요청이다. 그 둘을 쿠키만으로 구분할 수 없어서 판정이 두 겹이다. 이 loader는 화면을 그리지 않고
 * 자식과 나란히 서서, page가 가진 static shell을 이 dynamic 경계 안으로 끌어들이지 않는다(ADR 0028 2항).
 *
 * 자식 page는 이 판정보다 먼저 렌더를 시작할 수 있다. 그래도 데이터가 새지 않는 이유는 layout의
 * redirect가 아니라 Nest guard가 401을 돌려주기 때문이다(ADR 0032 §1).
 */
async function WorkspaceSessionGate() {
  // 게이트가 실어 보낸 요청 경로다. layout은 자기 URL을 받지 못하고, 받는 쪽에서 같은 함수로 한 번 더
  // 판정하므로 이 값이 그대로 복귀 대상이 되지는 않는다.
  const requested = (await headers()).get(RETURN_PATH_HEADER);
  const decision = workspaceGateDecision(await getCurrentSessionFromServer());
  switch (decision.kind) {
    case 'login':
      return redirect(loginRouteWithReturn(requested));
    case 'setup':
      return redirect(setupRouteWithReturn(requested));
    case 'allow':
      return null;
  }
}

export default function WorkspaceLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <ApplicationShell sidebarFooter={<AccountHub />}>
      <Suspense fallback={null}>
        <WorkspaceSessionGate />
      </Suspense>
      {children}
    </ApplicationShell>
  );
}
