/** @module 책임: RSC에서만 쓰는, 세션 쿠키를 실어 나르는 분석 시간축 조회를 예상된 실패까지 결과 값으로 돌려준다. */
import 'server-only';

import type { AnalysisTimeSeriesV1Response } from '@eatbid/contracts/api/v1/analysis';

import { privateServerRequest } from '../_transport/private-server-request.server';
import { isAnalysisCohortNotFoundError } from './analysis-resource-error';
import {
  findAnalysisTimeSeriesWith,
  type AnalysisTimeSeriesQueryInput
} from './find-analysis-time-series';

/**
 * 없는 모집단은 예외가 아니라 결과다. 화면이 갈래를 `switch`로 고르게 두면 "조건을 고쳐야 한다"와
 * "표본이 없다"가 서로 다른 문구를 갖는다.
 *
 * `read-failed`도 값인 이유는 이 조회가 **화면의 일부**이기 때문이다. 예외로 던지면 이미 받아 온 공고
 * 헤더와 조건 막대까지 route error 경계가 통째로 대체해, 차트 하나를 못 그린 일이 화면이 사라진 일이
 * 된다(2026-09-19 `/today`에서 같은 모양의 사고). 우리 결함과 인증 실패는 여전히 던진다.
 */
export type AnalysisTimeSeriesRead =
  | { readonly kind: 'series'; readonly response: AnalysisTimeSeriesV1Response }
  | { readonly kind: 'cohort-not-found' }
  | { readonly kind: 'read-failed' };

/**
 * 이 조회는 `ProviderSessionGuard`가 걸린 제품 데이터 읽기다(ADR 0032 §12). `use cache` 경계 안에서는
 * 요청 쿠키를 읽을 수 없어(ADR 0028 §4) 게이트 앞에 익명으로 닿아 항상 401을 받는다 — EAT-165가 잡은
 * 장애가 같은 모양이었다. 쿠키를 그대로 실어 나르는 `privateServerRequest`로 세션을 전달한다.
 */
export async function findAnalysisTimeSeriesFromServer(
  input: AnalysisTimeSeriesQueryInput
): Promise<AnalysisTimeSeriesRead> {
  try {
    return { kind: 'series', response: await findAnalysisTimeSeriesWith(privateServerRequest, input) };
  } catch (error) {
    if (isAnalysisCohortNotFoundError(error)) return { kind: 'cohort-not-found' };
    if (privateServerRequest.isUpstreamUnavailable(error)) return { kind: 'read-failed' };
    throw error;
  }
}
