/**
 * @module 책임: 로그인·첫 설정 route를 업무 route와 같은 application chrome·계정 슬롯·운영자 탐색 묶음에 연결한다. 내 사업자
 * 화면(/setup)에서 운영자 메뉴가 사라지면 오늘 투찰로 돌아갈 길이 없어진다(EAT-338).
 */
import { Suspense } from 'react';

import { AccountHubSlot, OperatorNavSlot } from '@/capabilities/account/server';
import { ApplicationShell } from '@/shell/layout/application-shell';

export default function AuthLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <ApplicationShell
      sidebarFooter={<AccountHubSlot />}
      sidebarExtraNav={
        <Suspense fallback={null}>
          <OperatorNavSlot />
        </Suspense>
      }
    >
      {children}
    </ApplicationShell>
  );
}
