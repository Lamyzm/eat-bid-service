/**
 * @module 책임: 하한선 자리 URL의 지역·기간·1~10등 층·보기 탭·처음 확대할 달을 nuqs parser로 읽는다.
 *
 * 지역·기간·1~10등은 서버 조회를 바꾸므로 주소에 둔다 — 고른 화면이 곧 즐겨찾기할 주소다. 보기 탭도 주소에 두어 다른 화면이
 * "달별 보기"로 바로 링크할 수 있게 한다(EAT-356). 칸 너비·입력값처럼 화면 안에서만 도는 상태는 주소에 두지 않는다.
 */
import { parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs/server';

import { FLOOR_PERIODS } from '@/entities/floor-line/floor-period';

export type { FloorPeriodKey } from '@/entities/floor-line/floor-period';

export const FLOOR_VIEWS = ['points', 'months', 'rule'] as const;
export type FloorViewKey = (typeof FLOOR_VIEWS)[number];

export const floorSearchParsers = {
  region: parseAsString,
  period: parseAsStringLiteral(FLOOR_PERIODS).withDefault('1y'),
  ranks: parseAsBoolean.withDefault(false),
  view: parseAsStringLiteral(FLOOR_VIEWS).withDefault('points'),
  /** 복기 입구 줄이 여는 달(`2026-09`)이다. 공고별 그림이 그 달로 확대돼 열리고 달별 표가 그 줄을 표시한다. */
  month: parseAsString
};

/** 주소의 지역 값이 내부 숫자 ID 모양인지 본다. 아니면 고르지 않은 것으로 읽는다(ADR 0018). */
export function regionIdOf(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && /^[1-9][0-9]{0,18}$/.test(value) ? value : null;
}

/** 마지막으로 본 시군구를 이 브라우저에 남기는 쿠키다. 메뉴에서 들어와도 지난번 지역이 바로 보이게 하는 편의일 뿐 계정 상태가 아니다. */
export const FLOOR_REGION_COOKIE = 'eatbid_floor_region';
