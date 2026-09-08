/** @module 책임: localStorage를 진실 원천으로 삼던 legacy 사업자 화면의 직접 진입을 canonical 설정으로 넘긴다. */
import { permanentRedirect } from 'next/navigation';

/**
 * 화면을 남겨 두면 같은 개념의 진실 원천이 둘로 보인다. 브라우저에 남은 번호를 로그인 계정으로 옮기지도
 * 않는다. 자동 병합은 공용 PC에서 남의 기록을 남의 계정에 붙이는 경로다(ADR 0032 §9).
 */
export default function LegacyMyBusinessPage(): never {
  permanentRedirect('/setup');
}
