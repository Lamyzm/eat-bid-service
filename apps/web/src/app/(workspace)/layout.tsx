import { ApplicationShell } from '@/shell/layout/application-shell';

/** canonical 업무 route를 제품 기능과 무관한 공통 application chrome에 연결한다. */
export default function WorkspaceLayout({ children }: { readonly children: React.ReactNode }) {
  return <ApplicationShell>{children}</ApplicationShell>;
}
