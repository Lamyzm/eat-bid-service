/** @module 책임: 한 줄에 나란히 서는 여닫이 조작(Combobox·Popover·감싼 select)의 공통 껍데기 클래스를 소유한다. */

/**
 * 조건 막대처럼 여닫이가 여섯 개 나란히 서는 자리에서는 테두리·높이·모서리·화살표 자리가 칸마다
 * 다르면 사용자가 서로 다른 종류의 조작으로 읽는다(2026-09-18 디자인 심사). 그래서 모양은 한 곳이
 * 소유하고 primitive들은 이것을 인용한다.
 *
 * 초점 표시는 각 primitive가 더한다. 스스로 초점을 받는 trigger는 `focus-visible:`, 안쪽 요소가
 * 초점을 받는 감싼 `select`는 `focus-within:`이라 여기서 하나로 정할 수 없다.
 */
export const controlPillClass =
  'flex h-8 w-fit min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-background px-2 text-sm font-medium whitespace-nowrap text-foreground outline-none aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50';

/** 껍데기 오른쪽 끝의 `⌄` 아이콘이다. 여닫이라는 사실을 말할 뿐이라 이름을 갖지 않는다. */
export const controlPillIconClass = 'pointer-events-none size-4 shrink-0 text-muted-foreground';
