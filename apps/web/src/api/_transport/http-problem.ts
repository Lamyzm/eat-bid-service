/** @module 책임: 계약 불일치와 표준 Problem 및 일반 HTTP 실패를 구분하는 오류 타입을 제공한다. */
import type { ProblemCode, ProblemDetails } from '@eatbid/contracts/api';

export class ContractResponseError extends Error {
  readonly name = 'ContractResponseError';

  constructor(
    readonly operationId: string,
    readonly status: number,
    options?: ErrorOptions
  ) {
    super(`응답이 ${operationId}의 공개 계약과 일치하지 않습니다.`, options);
  }
}

export class HttpProblemError extends Error {
  readonly name = 'HttpProblemError';
  readonly code: ProblemCode;
  readonly requestId: string;
  readonly status: number;

  constructor(readonly problem: ProblemDetails) {
    super(`HTTP ${problem.status}: ${problem.code}`);
    this.code = problem.code;
    this.requestId = problem.requestId;
    this.status = problem.status;
  }
}

export class HttpStatusError extends Error {
  readonly name = 'HttpStatusError';

  constructor(
    readonly status: number,
    readonly requestId?: string
  ) {
    super(`검증 가능한 Problem Details 없이 HTTP ${status} 응답을 받았습니다.`);
  }
}

/**
 * 재시도까지 쓰고도 **상대가 답을 못 준** 실패다. 이 판정을 transport가 소유하는 이유는, 무엇이 장애이고
 * 무엇이 우리 결함인지가 status와 오류 타입에 달려 있고 그 둘 다 여기서 만들어지기 때문이다. resource가
 * 각자 status 숫자를 세면 같은 사실이 화면마다 다른 뜻을 갖는다.
 *
 * 우리 쪽 결함(계약 불일치, 4xx 대부분)과 인증 실패는 포함하지 않는다. 그것을 장애로 내리면 고쳐야 할
 * 버그가 "잠시 뒤 다시" 문구 뒤에 숨는다.
 */
export function isUpstreamUnavailable(error: unknown): boolean {
  // 예산을 넘겨 transport가 끊은 경우다. 시간 제한과 취소는 이름으로만 구분되는 오류로 온다.
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return true;
  if (error instanceof HttpProblemError || error instanceof HttpStatusError) {
    // 재시도 대상과 같은 집합이다. 여기까지 왔다는 것은 그 재시도를 다 쓰고도 같은 답을 받았다는 뜻이다.
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  // HTTP 응답 자체가 없었던 경우(연결 거절·DNS·소켓 끊김)다. fetch는 그것을 `TypeError`로 알린다.
  return error instanceof TypeError;
}
