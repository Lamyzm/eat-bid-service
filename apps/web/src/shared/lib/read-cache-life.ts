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

/**
 * `revalidateTag`의 둘째 인자는 "표시한 뒤에도 얼마나 더 옛 값을 내보내도 되는가"다. 기본 profile을
 * 주면 발행 직후 첫 열람이 여전히 옛 값을 받아 "전환 뒤 첫 열람은 새 값"이라는 acceptance를 정의상
 * 만족하지 못한다. push는 이미 새 사실이 있다는 신호이므로 유예를 두지 않는다(ADR 0036-2).
 */
export const REVALIDATE_IMMEDIATELY = Object.freeze({ expire: 0 });
