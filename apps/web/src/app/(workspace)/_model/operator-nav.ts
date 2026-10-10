/**
 * @module 책임: 세션 판정에서 운영자에게만 보이는 사이드바 묶음(내 투찰)을 만든다.
 *
 * 묶음을 그릴지는 세션의 `operator` 표시로 정하지만 권한의 권위는 각 operation의 guard다 — 표시만 믿고 화면을 열어도 서버가 다시
 * 판정한다(PDR-0008). 세션을 읽지 못하면 묶음을 그리지 않는다. 없는 메뉴가 잠깐 보였다 사라지는 것보다 늦게 나타나는 편이 낫다.
 */
import type { CurrentSessionRead } from '@/api/account/server';
import type { NavGroup } from '@/shell/layout/nav-config';

export function operatorNavGroup(read: CurrentSessionRead): NavGroup | null {
  if (read.kind !== 'session' || read.response.state !== 'active' || !read.response.operator) return null;
  return {
    label: '내 투찰',
    items: [{ title: '오늘 투찰', url: '/work', icon: 'post', isActive: false, items: [] }]
  };
}
