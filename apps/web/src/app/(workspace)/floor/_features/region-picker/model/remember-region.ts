/**
 * @module 책임: 고른 시군구를 이 브라우저 쿠키에 남겨 다음에 메뉴로 들어와도 같은 지역이 바로 보이게 한다.
 *
 * 계정 상태가 아니라 화면 편의다 — 관심 지역(참가제한지역)과 공고지역은 다른 코드 체계라 관심 지역에서 끌어오지 않는다(AGENTS 6).
 * 값은 숫자 ID만 남긴다. 서버는 읽을 때 같은 모양 검사(`regionIdOf`)를 다시 한다.
 */
import { FLOOR_REGION_COOKIE, regionIdOf } from '@/app/(workspace)/floor/_lib/floor-search';

const ONE_YEAR_SECONDS = 31_536_000;

export function rememberRegion(regionId: string): void {
  if (regionIdOf(regionId) === null) return;
  const secure = window.location.protocol === 'https:' ? ' Secure;' : '';
  document.cookie = `${FLOOR_REGION_COOKIE}=${regionId}; path=/floor; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax;${secure}`;
}
