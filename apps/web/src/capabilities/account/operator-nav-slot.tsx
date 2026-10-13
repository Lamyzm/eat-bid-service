/**
 * @module 책임: layout이 사이드바에 넘기는 운영자 전용 탐색 묶음(내 투찰)을 서버가 읽은 세션으로 조립한다. 업무 화면과 내 사업자
 * 화면이 같은 슬롯을 쓴다 — 한쪽에만 붙이면 화면을 옮기는 순간 메뉴가 사라진다(EAT-338).
 */
import { connection } from 'next/server';

import { getCurrentSessionFromServer } from '@/api/account/server';
import { NavGroupMenus } from '@/shell/layout/nav-group-menu';

import { operatorNavGroup } from './operator-nav';

/**
 * 같은 요청의 게이트·계정 슬롯과 같은 요청 범위 memo 조회를 쓰므로 세션 계약 조회가 늘지 않는다. 묶음이 없는 동안(static
 * shell, 조회 전)은 아무것도 그리지 않는다 — 권한의 권위는 operation guard라서 늦게 나타나는 것은 정확성 문제가 아니다.
 */
export async function OperatorNavSlot() {
  // 계정 슬롯과 같은 이유로 요청에 닿았음을 먼저 알린다. 없으면 prerender가 API_URL 없는 origin 해석에서 throw해
  // 빌드가 멈춘다(EAT-163, account-hub-slot.tsx).
  await connection();
  const group = operatorNavGroup(await getCurrentSessionFromServer());
  return group === null ? null : <NavGroupMenus groups={[group]} />;
}
