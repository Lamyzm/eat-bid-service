/**
 * @module 책임: 모든 화면 묶음이 쓰는 application chrome에 계정 슬롯과 운영자 탐색 묶음을 한 번에 붙인다. 화면 묶음 layout마다
 * 슬롯을 따로 붙이면 한쪽을 빠뜨리는 순간 그 화면에서 메뉴가 사라진다(EAT-338: 내 사업자 화면에서 오늘 투찰이 사라졌다).
 */
import { Suspense } from 'react';

import { ApplicationShell } from '@/shell/layout/application-shell';

import { AccountHubSlot } from './account-hub-slot';
import { OperatorNavSlot } from './operator-nav-slot';

/** 세션을 읽는 두 슬롯은 각자 Suspense 안에 있어 shell의 static 부분을 dynamic 경계로 끌어들이지 않는다(ADR 0028 2항). */
export function AccountShell({ children }: { readonly children: React.ReactNode }) {
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
