/** @module 책임: canonical 업무 route를 공통 application chrome과 세션 계약을 읽는 계정 슬롯에 연결한다. */
import { AccountHub } from '@/capabilities/account';
import { ApplicationShell } from '@/shell/layout/application-shell';
export default function WorkspaceLayout({ children }: { readonly children: React.ReactNode }) {
  return <ApplicationShell sidebarFooter={<AccountHub />}>{children}</ApplicationShell>;
}
