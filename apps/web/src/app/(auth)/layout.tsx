/** @module 책임: 로그인·첫 설정 route를 업무 route와 같은 application chrome과 계정 슬롯에 연결한다. */
import { AccountHubSlot } from '@/capabilities/account/server';
import { ApplicationShell } from '@/shell/layout/application-shell';

export default function AuthLayout({ children }: { readonly children: React.ReactNode }) {
  return <ApplicationShell sidebarFooter={<AccountHubSlot />}>{children}</ApplicationShell>;
}
