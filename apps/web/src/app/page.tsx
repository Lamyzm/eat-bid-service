/** @module 책임: 루트 진입을 canonical 시작 화면인 오늘로 넘기는 redirect만 담당한다. */
import { redirect } from 'next/navigation';

export default async function Page() {
  redirect('/today');
}
