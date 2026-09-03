/** @module 책임: 결정 화면 전체 조건(기간·모집단)을 URL search param으로 보존하는 nuqs parser를 한 곳에서 소유한다. page.tsx의 Suspense loader가 서버에서 `createLoader`로 이 parser를 실행하므로 client 전용 'nuqs'가 아니라 'nuqs/server'에서 가져온다. */
import { parseAsStringLiteral } from 'nuqs/server';

export const DECISION_PERIODS = ['12개월', '3개월', '이번 달', '지난 달'] as const;
export const DECISION_SCOPES = ['전국', '도', '시군', '이 기관'] as const;

export const decisionSearchParsers = {
  period: parseAsStringLiteral(DECISION_PERIODS).withDefault('12개월'),
  scope: parseAsStringLiteral(DECISION_SCOPES).withDefault('전국')
};

export type DecisionSearch = {
  readonly period: (typeof DECISION_PERIODS)[number];
  readonly scope: (typeof DECISION_SCOPES)[number];
};
