/** @module 책임: RSC 읽기 캐시의 유계 수명 상한 하나를 web 전역 정책으로 소유한다. */

/**
 * `use cache` 기본 profile은 만료가 없어 무효화 push가 한 번 유실되면 pod가 재시작할 때까지 stale이
 * 남는다. 이 값은 신선도 요구가 아니라 **push 유실의 최대 피해**를 정한다(ADR 0036-5). push가
 * 정상이면 사용자는 이 상한을 만나지 않는다.
 *
 * revalidate 900초는 수집 주기 15분과 같아 "push가 죽어도 대략 한 주기 뒤 자연 갱신"과 같고,
 * expire 3600초는 아무것도 돌지 않는 밤에도 상한을 둔다. 세 read 함수가 같은 값을 쓰는 이유는
 * 어느 하나만 늙어 화면 안에서 서로 다른 시점의 사실이 섞이는 것을 막기 위해서다.
 */
export const READ_CACHE_LIFE = Object.freeze({
  stale: 300,
  revalidate: 900,
  expire: 3600
});
