/** @module 책임: 루트 진입을 내 투찰의 전제인 사업자 설정 화면으로 넘기는 redirect만 담당한다. */
import { redirect } from 'next/navigation';

export default async function Page() {
  redirect('/setup');
}
