/** @module 책임: 결정 화면 전체 조건(기간·모집단)을 URL search param으로 보존하는 nuqs parser를 한 곳에서 소유한다. */
import { parseAsStringLiteral } from 'nuqs';

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
