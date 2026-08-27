import { NavGroup } from '@/types';

/**
 * Navigation configuration with RBAC support
 *
 * This configuration is used for both the sidebar navigation and Cmd+K bar.
 * Items are organized into groups, each rendered with a SidebarGroupLabel.
 *
 * RBAC Access Control:
 * Each navigation item can have an `access` property that controls visibility
 * based on permissions, plans, features, roles, and organization context.
 *
 * Examples:
 *
 * 1. Require organization:
 *    access: { requireOrg: true }
 *
 * 2. Require specific permission:
 *    access: { requireOrg: true, permission: 'org:teams:manage' }
 *
 * 3. Require specific plan:
 *    access: { plan: 'pro' }
 *
 * 4. Require specific feature:
 *    access: { feature: 'premium_access' }
 *
 * 5. Require specific role:
 *    access: { role: 'admin' }
 *
 * 6. Multiple conditions (all must be true):
 *    access: { requireOrg: true, permission: 'org:teams:manage', plan: 'pro' }
 *
 * Note: The `visible` function is deprecated but still supported for backward compatibility.
 * Use the `access` property for new items.
 */
export const navGroups: NavGroup[] = [
  {
    label: '입찰',
    items: [
      { title: '오늘', url: '/dashboard/today', icon: 'sun', isActive: false, shortcut: ['t', 't'], items: [] },
      { title: '학교 찾기', url: '/dashboard/schools', icon: 'search', isActive: false, shortcut: ['s', 's'], items: [] },
      { title: '내 성적표', url: '/dashboard/record', icon: 'checks', isActive: false, shortcut: ['r', 'r'], items: [] },
      { title: '시장 지도', url: '/dashboard/market', icon: 'dashboard', isActive: false, shortcut: ['m', 'm'], items: [] }
    ]
  },
  {
    label: '설정',
    items: [
      { title: '내 사업자', url: '/dashboard/my', icon: 'settings', isActive: false, shortcut: ['b', 'b'], items: [] }
    ]
  }
];
