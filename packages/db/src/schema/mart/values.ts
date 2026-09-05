/**
 * @module 책임: mart 표들이 공유하는 비율·금액 열의 자릿수 계약을 한 곳에서 만든다.
 *
 * 비율의 기준(basis)이 둘이라 자릿수도 둘이다. 사정률은 예정가격이 분모이고 상한이 없어
 * core와 같은 `numeric(15,3)`이며, 투찰률은 기초금액이 분모인 파생 표시값이라 실효하한을 손실 없이
 * 담는 최소 자리인 `numeric(9,4)`다. 이 둘을 한 이름으로 합치는 순간 화면이 서로 다른 분모의 두
 * 숫자를 나란히 비교한다(AGENTS 15, ADR 0033 §2, ADR 0034).
 */
import { numeric } from "drizzle-orm/pg-core";

export const assessmentRate = (name: string) => numeric(name, { precision: 15, scale: 3 });

export const bidRate = (name: string) => numeric(name, { precision: 9, scale: 4 });

// 소스가 표시한 하한율·구간 경계처럼 소수 셋째 자리 고정 관측값이다.
export const observedRate = (name: string) => numeric(name, { precision: 6, scale: 3 });

export const martMoney = (name: string) => numeric(name, { precision: 18, scale: 2 });
