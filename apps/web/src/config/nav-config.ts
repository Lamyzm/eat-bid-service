/** @module 책임: sidebar와 command palette가 공유하는 route·아이콘·접근 조건 navigation을 선언한다. */
import type { NavGroup } from '@/types';

// 제품 navigation은 `투찰 업무 /work | 복기 /review | 성과 /performance` 세 항목이다(screen-system §3).
// typed route가 없는 경로는 typecheck에 실패하므로 이 목록 교체는 `/work` route가 생기는 slice와 같은
// 변경에서만 수행하고, 그 전까지 스타터 잔재 항목을 유지한다. 존재하지 않는 route를 미리 링크하지 않는다.

/**
 * 접근 제어를 포함한 navigation 설정이다.
 *
 * sidebar와 Cmd+K가 같은 항목을 사용하며 각 group은 SidebarGroupLabel로 표시한다.
 *
 * 각 항목의 `access`는 permission, plan, feature, role과 organization context를 기준으로
 * 노출 여부를 결정한다.
 *
 * 예시:
 *
 * 1. organization 필수:
 *    access: { requireOrg: true }
 *
 * 2. 특정 permission 필수:
 *    access: { requireOrg: true, permission: 'org:teams:manage' }
 *
 * 3. 특정 plan 필수:
 *    access: { plan: 'pro' }
 *
 * 4. 특정 feature 필수:
 *    access: { feature: 'premium_access' }
 *
 * 5. 특정 role 필수:
 *    access: { role: 'admin' }
 *
 * 6. 여러 조건 모두 필수:
 *    access: { requireOrg: true, permission: 'org:teams:manage', plan: 'pro' }
 *
 * `visible` 함수는 deprecated 호환 경로로만 남아 있다. 새 항목은 `access`를 사용한다.
 */
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
