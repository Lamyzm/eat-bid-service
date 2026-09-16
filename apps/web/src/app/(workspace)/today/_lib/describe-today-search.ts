/** @module 책임: 주소에 걸린 오늘 조건을 사람이 읽는 한 문장과 금액 표기로 바꾼다. 0건 화면과 조건 기둥이 같은 문구를 쓰도록 문장 규칙을 한 곳에 둔다. */
import type { TodaySearch } from './today-search-params';

/** 계약의 소수 둘째 자리 고정 형식을 사람이 읽는 천 단위로 되돌린다. 반올림하지 않고 소수부만 뗀다. */
export function wonText(amount: string): string {
  return amount.split('.')[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function baseAmountLabel(search: TodaySearch): string | null {
  const { baseAmountMin: min, baseAmountMax: max } = search;
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${wonText(min)}~${wonText(max)}`;
  return min === null ? `${wonText(max!)} 이하` : `${wonText(min)} 이상`;
}

/**
 * 결과 0 상태가 되풀이해 말하는 조건 문장. 조건이 없으면 null이다.
 *
 * 날짜 축 둘을 빠뜨리면 달력에서 0건인 날을 골랐을 때 화면이 `지금 열린 공고가 없습니다`라고만 말하고
 * 해제할 것도 못 내놓는다. 무엇 때문에 0인지를 문장이 말해야 사용자가 되돌릴 자리를 안다.
 */
export function describeTodaySearch(search: TodaySearch, regionText: string | null): string | null {
  const parts: string[] = [];
  if (search.sido !== null) parts.push(`지역 ${regionText ?? `코드 ${search.sido}`}`);
  if (search.items !== null) parts.push(`품목 ${search.items.join(' · ')}`);
  if (search.q !== null) parts.push(`검색 “${search.q}”`);
  if (search.closesOn !== null) parts.push(`마감 ${search.closesOn}`);
  if (search.announcedOn !== null) parts.push(`게시 ${search.announcedOn}`);
  if (search.closesWithinHours !== null) parts.push(`기간 ${search.closesWithinHours}시간 안`);
  const amount = baseAmountLabel(search);
  if (amount !== null) parts.push(`기초금액 ${amount}`);
  return parts.length === 0 ? null : parts.join(' · ');
}
