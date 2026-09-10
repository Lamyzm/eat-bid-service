/** @module 책임: sidebar와 command palette가 함께 읽는 workspace navigation 항목과 그 항목이 가질 수 있는 형태를 선언한다. */
import type { Route } from 'next';
import type { Icons } from '@/shared/ui/icons';

// 제품 navigation은 `투찰 업무 /work | 복기 /review | 성과 /performance` 세 항목이다(screen-system §3).
// typed route가 없는 경로는 typecheck에 실패하므로 이 목록 교체는 `/work` route가 생기는 slice와 같은
// 변경에서만 수행하고, 그 전까지 스타터 잔재 항목을 유지한다. 존재하지 않는 route를 미리 링크하지 않는다.

/**
 * navigation 한 항목이다.
 *
 * `url`은 generated route type으로 검사하며 하위 항목이 있는 그룹 헤더만 `'#'`을 쓴다.
 * `icon`은 `Icons` registry의 key라서 임의 문자열이 들어오면 typecheck가 막는다.
 */
export interface NavItem {
  title: string;
  url: Route | '#';
  disabled?: boolean;
  external?: boolean;
  shortcut?: [string, string];
  icon?: keyof typeof Icons;
  label?: string;
  description?: string;
  isActive?: boolean;
  items?: NavItem[];
}

/** sidebar의 SidebarGroupLabel과 command palette의 group heading이 함께 쓰는 묶음이다. */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** sidebar와 Cmd+K가 같은 항목을 사용하며 각 group은 SidebarGroupLabel로 표시한다. */
export const navGroups: NavGroup[] = [
  {
    label: '공고',
    items: [
      // 오늘은 canonical `/today`(EAT-39)가 소유한다.
      { title: '오늘', url: '/today', icon: 'sun', isActive: false, shortcut: ['t', 't'], items: [] }
    ]
  },
  {
    label: '나',
    items: [
      // 사업자 등록의 진실 원천은 로그인 계정이다. 이 항목이 localStorage 화면을 가리키면 같은 개념의
      // 진실 원천이 둘로 보인다. canonical `/setup`이 유일한 진입이다(ADR 0032 §5).
      { title: '내 사업자', url: '/setup', icon: 'settings', isActive: false, shortcut: ['b', 'b'], items: [] }
    ]
  }
];
