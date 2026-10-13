/** @module 책임: 로그인·첫 설정 route를 업무 route와 같은 계정 chrome(계정 슬롯·운영자 탐색 묶음)에 연결한다. */
import { AccountShell } from '@/capabilities/account/server';

export default function AuthLayout({ children }: { readonly children: React.ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
